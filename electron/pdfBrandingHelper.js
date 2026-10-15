/** Same helper in every workspace; the server transforms bytes and never accepts a path. */
function brandPdfScript() {
  return `# mi-generated:harness-v1
param(
  [Parameter(Mandatory=$true)][string]$SourcePath,
  [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($env:MI_LOCAL_ORIGIN)) { throw "Run this helper inside a Mi terminal." }
$origin = [Uri]$env:MI_LOCAL_ORIGIN
if (-not $origin.IsLoopback -or $origin.Scheme -ne "http") { throw "Mi must use its local loopback server." }
$source = (Resolve-Path -LiteralPath $SourcePath).ProviderPath
$output = [IO.Path]::GetFullPath($OutputPath)
if ([IO.Path]::GetExtension($source) -ine ".pdf" -or [IO.Path]::GetExtension($output) -ine ".pdf") { throw "Both paths must end in .pdf." }
if ([IO.File]::Exists($output)) { throw "Output already exists. Choose a new draft filename; this helper never overwrites." }
if ((Get-Item -LiteralPath $source).Length -gt 20971520) { throw "PDFs must be 20 MB or smaller." }
Add-Type -AssemblyName System.Net.Http
$client = New-Object System.Net.Http.HttpClient
$content = New-Object System.Net.Http.ByteArrayContent -ArgumentList (,[IO.File]::ReadAllBytes($source))
$content.Headers.ContentType = New-Object System.Net.Http.Headers.MediaTypeHeaderValue("application/pdf")
try {
  $response = $client.PostAsync("$($origin.GetLeftPart([UriPartial]::Authority))/api/pdf/brand", $content).GetAwaiter().GetResult()
  try {
    if (-not $response.IsSuccessStatusCode) { throw $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() }
    $bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
    $stream = [IO.File]::Open($output, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
    [ordered]@{ output = $output; branding = ($response.Headers.GetValues("X-Mi-Branding") -join ""); sha256 = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash; message = "Review the branded PDF before sharing it." } | ConvertTo-Json
  } finally { $response.Dispose() }
} finally { $content.Dispose(); $client.Dispose() }
`;
}

module.exports = { brandPdfScript };
