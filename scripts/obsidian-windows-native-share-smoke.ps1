# MSI-only, offline Windows CreateFileW sharing-mode rehearsal.
# Generates its own isolated TEMP fixture and never accepts a Vault path.
# IMPORTANT: This is NOT an atomic compare-and-swap writer or a sync tool.
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw "This synthetic Windows native share-mode rehearsal requires Windows."
}
$root = $null
$handle = $null
try {
  $temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
  $root = Join-Path $temp ("naosledge-native-share-synthetic-only-" + [Guid]::NewGuid().ToString("N"))
  if ([IO.Path]::GetDirectoryName($root).TrimEnd('\') -ine $temp -or
      [IO.Path]::GetFileName($root) -notmatch '^naosledge-native-share-synthetic-only-[a-f0-9]{32}$') {
    throw "Refusing to use a path outside a new isolated synthetic TEMP root."
  }
  [IO.Directory]::CreateDirectory($root) | Out-Null
  $note = Join-Path $root "synthetic-note.md"
  $moved = $note + ".moved"
  [IO.File]::WriteAllText($note, "synthetic-original")

  $nativeSource = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class NaosledgeSyntheticNativeShareGuard {
    private const uint GENERIC_READ = 0x80000000;
    private const uint FILE_SHARE_READ = 0x00000001;
    private const uint OPEN_EXISTING = 3;
    private const uint FILE_ATTRIBUTE_NORMAL = 0x00000080;

    [DllImport("kernel32.dll", EntryPoint = "CreateFileW",
        CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(
        string fileName, uint desiredAccess, uint shareMode,
        IntPtr securityAttributes, uint creationDisposition,
        uint flagsAndAttributes, IntPtr templateFile);

    public static SafeFileHandle HoldReadAndDenyWriteDelete(string fileName) {
        // Sharing flags apply while this handle is held. They do not make
        // an external check + rename a conditional atomic transaction.
        SafeFileHandle result = CreateFileW(fileName, GENERIC_READ,
            FILE_SHARE_READ, IntPtr.Zero, OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL, IntPtr.Zero);
        if (result.IsInvalid) {
            int error = Marshal.GetLastWin32Error();
            result.Dispose();
            throw new Win32Exception(error,
                "Synthetic CreateFileW share guard could not open the file.");
        }
        return result;
    }
}
'@
  Add-Type -TypeDefinition $nativeSource -ErrorAction Stop

  $exe = Join-Path $PSHOME "powershell.exe"
  if (-not [IO.File]::Exists($exe)) {
    throw "Windows PowerShell child process not available."
  }

  function Invoke-SyntheticChild([string]$mode, [string]$target) {
    if ($mode -notin @("read","write","rename","delete")) {
      throw "Unsupported synthetic child operation."
    }
    if ([IO.Path]::GetFullPath($target) -ne [IO.Path]::GetFullPath($note) -and
        [IO.Path]::GetFullPath($target) -ne [IO.Path]::GetFullPath($moved)) {
      throw "Child target is not an exact synthetic fixture file."
    }
    $encodedPath = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($target))
    $childCode = @'
$ErrorActionPreference='Stop'
$p=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('__PATH_B64__'))
try {
  switch ('__MODE__') {
    'read'   { [void][IO.File]::ReadAllText($p) }
    'write'  { [IO.File]::WriteAllText($p,'synthetic-child-write') }
    'rename' { [IO.File]::Move($p,$p+'.moved') }
    'delete' { [IO.File]::Delete($p) }
  }
  exit 0
} catch {
  exit 73
}
'@
    $childCode = $childCode.Replace('__PATH_B64__', $encodedPath).Replace('__MODE__', $mode)
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($childCode))
    $process = Start-Process -FilePath $exe -ArgumentList @(
      "-NoProfile", "-NonInteractive", "-EncodedCommand", $encoded
    ) -WindowStyle Hidden -Wait -PassThru -ErrorAction Stop
    if ($process.Id -eq $PID) {
      throw "Expected an independent operating-system process."
    }
    return [int]$process.ExitCode
  }

  $handle = [NaosledgeSyntheticNativeShareGuard]::HoldReadAndDenyWriteDelete($note)
  if ($handle.IsInvalid -or $handle.IsClosed) {
    throw "Native handle unexpectedly unavailable."
  }

  $lockedRead = Invoke-SyntheticChild "read" $note
  $lockedWrite = Invoke-SyntheticChild "write" $note
  $lockedRename = Invoke-SyntheticChild "rename" $note
  $lockedDelete = Invoke-SyntheticChild "delete" $note
  if ($lockedRead -ne 0 -or $lockedWrite -ne 73 -or
      $lockedRename -ne 73 -or $lockedDelete -ne 73) {
    throw "Windows share mode did not produce the expected synthetic access behavior."
  }
  if ([IO.File]::ReadAllText($note) -ne "synthetic-original" -or
      [IO.File]::Exists($moved) -or -not [IO.File]::Exists($note)) {
    throw "Original synthetic content changed while a native handle was held."
  }

  $handle.Dispose()
  $handle = $null
  if ((Invoke-SyntheticChild "write" $note) -ne 0 -or
      [IO.File]::ReadAllText($note) -ne "synthetic-child-write") {
    throw "After releasing the handle, synthetic child writes should work."
  }
  if ((Invoke-SyntheticChild "rename" $note) -ne 0 -or
      [IO.File]::Exists($note) -or
      [IO.File]::ReadAllText($moved) -ne "synthetic-child-write") {
    throw "After releasing the handle, synthetic child rename should work."
  }
  if ((Invoke-SyntheticChild "delete" $moved) -ne 0 -or [IO.File]::Exists($moved)) {
    throw "After releasing the handle, synthetic child delete should work."
  }
  $evidence = [ordered]@{
    status = "pass"
    syntheticOnly = $true
    nativeApi = "CreateFileW"
    shareMode = "FILE_SHARE_READ"
    independentChildProcesses = $true
    readWhileHeldAllowed = $true
    writeWhileHeldDenied = $true
    renameWhileHeldDenied = $true
    deleteWhileHeldDenied = $true
    writeAfterCloseAllowed = $true
    renameAfterCloseAllowed = $true
    deleteAfterCloseAllowed = $true
    atomicCompareAndSwapAvailable = $false
    realVaultTouched = $false
    neonProductionTouched = $false
    automaticSyncEnabled = $false
  }
  Write-Output ("NAOSLEDGE_WINDOWS_NATIVE_SHARE_SMOKE " +
    (ConvertTo-Json -InputObject $evidence -Compress -Depth 3))
} finally {
  if ($null -ne $handle) { $handle.Dispose() }
  if ($null -ne $root) {
    $temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
    $safeParent = [IO.Path]::GetDirectoryName($root).TrimEnd('\')
    $safeName = [IO.Path]::GetFileName($root)
    if ($safeParent -ine $temp -or
        $safeName -notmatch '^naosledge-native-share-synthetic-only-[a-f0-9]{32}$') {
      throw "Refusing cleanup outside the generated synthetic TEMP folder."
    }
    if ([IO.Directory]::Exists($root)) {
      [IO.Directory]::Delete($root, $true)
    }
  }
}
