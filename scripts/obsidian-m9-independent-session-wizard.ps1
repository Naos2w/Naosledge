# M9 independent Production Owner Auth: MSI-only explicit interactive login.
# Neither password nor session cookie is written to argv, environment, log or
# the browser profile. Node seals the new *independent* session with user DPAPI.
$ErrorActionPreference='Stop'
if ($env:COMPUTERNAME -ne 'MSI') {
  throw 'M9 independent login is only supported on the approved MSI'
}
$repo=Split-Path -Parent $PSScriptRoot
$target=Join-Path $PSScriptRoot 'obsidian-m9-independent-session-cli.ts'
if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
  throw 'M9 enrollment CLI missing'
}
$email=Read-Host 'Naosledge Production Owner email'
$secure=Read-Host 'Independent Production Owner password' -AsSecureString
if (-not $secure -or $secure.Length -lt 1) {throw 'Password missing'}
$ptr=[IntPtr]::Zero
$password=$null
$json=$null
try {
  $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $password=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  $json=[ordered]@{
    email=$email
    password=$password
    typedConfirmation='ENROLL M9 INDEPENDENT PRODUCTION SESSION'
  } | ConvertTo-Json -Compress
  $json | & node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON $target '--m9-independent-owner-enroll'
  if($LASTEXITCODE -ne 0){throw 'M9 independent session enrollment was not verified'}
  Write-Output 'M9_DPAPI_INDEPENDENT_OWNER_SESSION_READY'
}finally{
  if($ptr -ne [IntPtr]::Zero){
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
  $password=$null
  $json=$null
  $secure.Dispose()
}
