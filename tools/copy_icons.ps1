# copy_icons.ps1
# Copies Universal Gold's form icons into the calc as src\img\icons\<calc name>.png,
# cut down to the first animation frame. Run convert_pbs.js first: it writes tools\icon_map.json.
#
# Usage (from your calc folder):
#   .\tools\copy_icons.ps1 -Game "C:\path\to\Universal Gold"

param(
  [Parameter(Mandatory = $true)][string]$Game
)

Add-Type -AssemblyName System.Drawing

$mapFile = Join-Path $PSScriptRoot 'icon_map.json'
if (-not (Test-Path $mapFile)) {
  Write-Host "icon_map.json not found. Run tools\convert_pbs.js first." -ForegroundColor Red
  exit 1
}
$iconDir = Join-Path $Game 'Graphics\Pokemon\Icons'
if (-not (Test-Path $iconDir)) {
  Write-Host "Icon folder not found: $iconDir" -ForegroundColor Red
  exit 1
}

$outDir = Join-Path $PSScriptRoot '..\src\img\icons'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$map = Get-Content $mapFile -Raw -Encoding UTF8 | ConvertFrom-Json
$copied = 0
$missing = @()

foreach ($entry in $map.PSObject.Properties) {
  $src = Join-Path $iconDir ($entry.Value + '.png')
  if (-not (Test-Path $src)) {
    $missing += $entry.Value
    continue
  }
  # Essentials icons are two square frames side by side; keep the first one.
  $img = [System.Drawing.Image]::FromFile($src)
  $size = $img.Height
  $frame = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($frame)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
  $g.DrawImage($img, $rect, $rect, [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  $img.Dispose()
  $frame.Save((Join-Path $outDir ($entry.Name + '.png')), [System.Drawing.Imaging.ImageFormat]::Png)
  $frame.Dispose()
  $copied++
}

Write-Host "Copied $copied icons to src\img\icons"
if ($missing.Count) {
  Write-Host "$($missing.Count) forms have no icon in Graphics\Pokemon\Icons:" -ForegroundColor Yellow
  $missing | ForEach-Object { Write-Host "  $_.png" }
}
