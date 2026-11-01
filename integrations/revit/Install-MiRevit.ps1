param([ValidateSet('Install','Uninstall')][string]$Action = 'Install')
$ErrorActionPreference = 'Stop'
$addinId = 'a7e3505e-21c2-4e29-92b1-4c6db1fc44f2'
$manifest = Join-Path $env:APPDATA 'Autodesk\Revit\Addins\2026\Mi.Native.addin'
if (Get-Process Revit -ErrorAction SilentlyContinue) { throw 'Close Revit before installing or removing Mi CAD.' }
if ((Test-Path -LiteralPath $manifest) -and -not ([IO.File]::ReadAllText($manifest).Contains("<AddInId>$addinId</AddInId>"))) {
  throw 'An unrelated Mi.Native.addin already exists. It was not changed.'
}
if ($Action -eq 'Uninstall') {
  if (Test-Path -LiteralPath $manifest) { Remove-Item -LiteralPath $manifest }
  Write-Output 'Mi CAD registration removed. Versioned payloads and existing pyRevit tools were preserved.'
  return
}
$payloadFile = Join-Path $PSScriptRoot 'payload.json'
$payload = Get-Content -LiteralPath $payloadFile -Raw | ConvertFrom-Json
if ($payload.year -ne '2026' -or $payload.apiVersion -ne '26.5.0.0' -or $payload.version -ne '0.1.0') { throw 'Unsupported native payload.' }
$api = Join-Path $env:ProgramFiles 'Autodesk\Revit 2026\RevitAPI.dll'
if (-not (Test-Path -LiteralPath $api) -or [Reflection.AssemblyName]::GetAssemblyName($api).Version.ToString() -ne $payload.apiVersion) {
  throw 'This add-in requires Revit API 26.5.0.0. Other Revit builds need a separate payload.'
}
$files = @($payload.files)
if ($files.Count -lt 1 -or $files.Count -gt 4 -or -not ($files.name -contains 'Mi.Revit.dll')) { throw 'Incomplete payload.' }
foreach ($file in $files) {
  if ($file.name -notin @('Mi.Revit.dll','Mi.Revit.deps.json','Mi.Revit.runtimeconfig.json')) { throw 'Invalid payload filename.' }
  $source = Join-Path $PSScriptRoot $file.name
  if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { throw "Payload hash mismatch: $($file.name)" }
}
$signature = Get-AuthenticodeSignature -LiteralPath (Join-Path $PSScriptRoot 'Mi.Revit.dll')
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne '0000000000000000000000000000000000000000') {
  throw 'The STUDIO signature could not be verified on this computer. No trust settings were changed.'
}
$identity = (Get-FileHash -LiteralPath $payloadFile -Algorithm SHA256).Hash.Substring(0,16).ToLowerInvariant()
$destination = Join-Path $env:LOCALAPPDATA "Mi\Revit\2026\0.1.0-$identity"
New-Item -ItemType Directory -Path $destination -Force | Out-Null
foreach ($file in $files) {
  $target = Join-Path $destination $file.name
  if (Test-Path -LiteralPath $target) {
    if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { throw 'Existing payload differs; no overwrite was performed.' }
  } else { [IO.File]::Copy((Join-Path $PSScriptRoot $file.name), $target, $false) }
  if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { throw 'Installed payload verification failed.' }
}
$assembly = [Security.SecurityElement]::Escape((Join-Path $destination 'Mi.Revit.dll'))
$contents = "<?xml version=`"1.0`" encoding=`"utf-8`"?><RevitAddIns><AddIn Type=`"Application`"><Name>Mi CAD Native</Name><Assembly>$assembly</Assembly><AddInId>$addinId</AddInId><FullClassName>Mi.Revit.App</FullClassName><VendorId>STUDIO</VendorId><VendorDescription>Mi native project CAD connection</VendorDescription></AddIn></RevitAddIns>"
New-Item -ItemType Directory -Path (Split-Path $manifest) -Force | Out-Null
$temporary = "$manifest.$([Guid]::NewGuid().ToString('N')).tmp"
[IO.File]::WriteAllText($temporary, $contents, (New-Object Text.UTF8Encoding($false)))
if (Test-Path -LiteralPath $manifest) { [IO.File]::Replace($temporary, $manifest, $null) } else { [IO.File]::Move($temporary, $manifest) }
Write-Output 'Mi CAD installed. Start Revit, then use Set up MCP in the updated Mi desktop app.'
