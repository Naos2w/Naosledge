<#
 .SYNOPSIS
   Explicit MSI-only M9 foreground control (NOT a service/autostart).
 .DESCRIPTION
   Prompts in a private PowerShell 7 console for an existing dedicated Neon
   Production schema-reader connection, never puts it on argv/env/files.
   The separate Owner session must already be enrolled. A signed M5 Owner
   enable is still required before any transfer; no auto-enrollment, no
   fault marker removal. The operator can pause, resume, inspect or stop.
   DO NOT execute until Production activation has been separately approved.
#>
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7 -or
    [Environment]::MachineName.ToUpperInvariant() -ne 'MSI') {
    throw 'M9 foreground operator requires Windows MSI and PowerShell 7.'
}
$expected = 'START M9 OWNER FOREGROUND AGENT'
$approval = Read-Host "Type exactly '$expected' to start the foreground controller"
if ($approval -cne $expected) {
    throw 'M9 foreground operator cancelled; no Agent started.'
}
$secret = Read-Host 'Existing Neon Production catalog-only schema-reader connection string' -AsSecureString
$process = $null
try {
    $databaseUrl = [System.Net.NetworkCredential]::new('', $secret).Password
    $entry = Join-Path $PSScriptRoot 'obsidian-m9-windows-foreground-auto-agent.ts'
    $p = [System.Diagnostics.ProcessStartInfo]::new()
    $p.FileName = (Get-Command node -ErrorAction Stop).Source
    $p.WorkingDirectory = Split-Path -Parent $PSScriptRoot
    $p.UseShellExecute = $false
    $p.CreateNoWindow = $false
    $p.RedirectStandardInput = $true
    [void]$p.ArgumentList.Add('--disable-warning=MODULE_TYPELESS_PACKAGE_JSON')
    [void]$p.ArgumentList.Add($entry)
    [void]$p.ArgumentList.Add('--m9-owner-foreground-auto-agent')
    $process = [System.Diagnostics.Process]::Start($p)
    if (-not $process) { throw 'M9 foreground child process did not start.' }

    $inputConfig = @{
        readOnlySchemaConnectionString = $databaseUrl
        typedConfirmation = $expected
    } | ConvertTo-Json -Compress
    $process.StandardInput.WriteLine($inputConfig)
    $process.StandardInput.Flush()
    Remove-Variable inputConfig,databaseUrl -ErrorAction SilentlyContinue

    Write-Host 'M9 foreground control: status, pause, resume, stop. No service installed.'
    while (-not $process.HasExited) {
        $command = (Read-Host 'M9 control [status/pause/resume/stop]').Trim().ToLowerInvariant()
        if ($command -notin @('status','pause','resume','stop')) {
            Write-Host 'Invalid M9 command; no operation performed.'
            continue
        }
        if ($process.HasExited) { break }
        $process.StandardInput.WriteLine($command)
        $process.StandardInput.Flush()
        if ($command -eq 'stop') { break }
    }
} finally {
    Remove-Variable secret,databaseUrl,approval -ErrorAction SilentlyContinue
    if ($process) {
        if (-not $process.HasExited) {
            try {
                $process.StandardInput.WriteLine('stop')
                $process.StandardInput.Flush()
            } catch {}
        }
        try { $process.StandardInput.Close() } catch {}
        if (-not $process.WaitForExit(30000)) {
            Write-Warning 'Foreground child has not exited; verify PID and fault latch manually. No forced termination.'
        }
        $process.Dispose()
    }
}
