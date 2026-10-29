# M8 P2c Windows native replacement helper.
# One controlled step: hold a READ-only FileStream excluding all external
# writers (FileShare.Read | FileShare.Delete), verify old SHA, and atomically
# replace the target while keeping that OS handle open.
#
# This helper is never called by an automatic scheduler or website route.
# The caller already validated exact MSI/OS-temp directory, signed M5 and
# Owner-RLS. No tokens, note bodies or owner IDs are passed to this process.
param(
  [Parameter(Mandatory=$true)][string]$Target,
  [Parameter(Mandatory=$true)][string]$Staged,
  [Parameter(Mandatory=$true)][string]$ReplacementBackup,
  [Parameter(Mandatory=$true)][string]$ExpectedSha256
)
$ErrorActionPreference = 'Stop'
try {
  if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
    throw 'Windows required'
  }
  if ($ExpectedSha256 -notmatch '^[a-f0-9]{64}$') { throw 'Expected hash invalid' }
  if (-not [System.IO.Path]::IsPathRooted($Target) -or
      -not [System.IO.Path]::IsPathRooted($Staged)) {
    throw 'Path invalid'
  }
  $a=[System.IO.Path]::GetFullPath($Target)
  $b=[System.IO.Path]::GetFullPath($Staged)
  $backup=[System.IO.Path]::GetFullPath($ReplacementBackup)
  if ([System.IO.File]::Exists($backup)) { throw 'Backup must be new' }
  if ([string]::Equals($backup,$a,[System.StringComparison]::OrdinalIgnoreCase) -or
      [string]::Equals($backup,$b,[System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Backup path aliases note'
  }
  if (-not [string]::Equals([System.IO.Path]::GetDirectoryName($a),
      [System.IO.Path]::GetDirectoryName($b),
      [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Replace requires same directory'
  }
  $stream=[System.IO.FileStream]::new($a,
      [System.IO.FileMode]::Open,
      [System.IO.FileAccess]::Read,
      ([System.IO.FileShare]::Read -bor [System.IO.FileShare]::Delete))
  try {
    $hash=[System.Security.Cryptography.SHA256]::Create()
    try {
      $digest=[System.BitConverter]::ToString(
          $hash.ComputeHash($stream)).Replace('-','').ToLowerInvariant()
    } finally { $hash.Dispose() }
    if ($digest -cne $ExpectedSha256) { throw 'Source changed' }
    if (-not [System.IO.File]::Exists($b)) { throw 'Staging missing' }
    # Win32 ReplaceFile atomic move; held FileStream refuses concurrent
    # writers until the move completes. If target has a writer handle that
    # does not share deletion, File.Replace fails safely (no fallback).
    [System.IO.File]::Replace($b,$a,$backup,$true)
    $verify=[System.Security.Cryptography.SHA256]::Create()
    try{
      $heldBackup=[System.IO.File]::OpenRead($backup)
      try{
        $read=[System.BitConverter]::ToString(
          $verify.ComputeHash($heldBackup)).Replace('-','').ToLowerInvariant()
      }finally{$heldBackup.Dispose()}
    }finally{$verify.Dispose()}
    if($read -cne $ExpectedSha256){throw 'Native recovery backup mismatch'}
  } finally { $stream.Dispose() }
  [Console]::Out.WriteLine('M8_NATIVE_REPLACE_OK')
  exit 0
} catch {
  # Redact target/staging filenames and any filesystem error descriptions.
  [Console]::Error.WriteLine('M8_NATIVE_REPLACE_REFUSED')
  exit 22
}
