# update.ps1
# Updates the Universal Gold calc from the game's PBS files and publishes it, in one step:
#   1. converts the PBS files (trainers, species, moves, abilities, items)
#   2. copies form icons from the game
#   3. builds the calc
#   4. commits and pushes to GitHub, which updates the live site
#
# Usage (from your calc folder):
#   .\tools\update.ps1 -Game "C:\path\to\Universal Gold"    the first time (the path is remembered)
#   .\tools\update.ps1                                       every time after that
#
# Options:
#   -Message "Added Route 30 trainers"   commit message (otherwise a dated default is used)
#   -SkipIcons                           skip copying icons (faster when no icons changed)
#   -NoPush                              build and commit, but don't publish yet

param(
  [string]$Game,
  [string]$Message,
  [switch]$SkipIcons,
  [switch]$NoPush
)

# Each step's result is checked by hand below, because git prints normal progress messages as
# "errors" that would otherwise stop the script.
$calcDir = Split-Path $PSScriptRoot -Parent
Set-Location $calcDir

function Step($text) { Write-Host "`n== $text ==" -ForegroundColor Cyan }
function Fail($text) {
  Write-Host "`n$text" -ForegroundColor Red
  Write-Host "Nothing was committed or pushed." -ForegroundColor Red
  exit 1
}

# Remember the game folder so it only has to be typed once.
$configFile = Join-Path $PSScriptRoot 'update_config.json'
if ($Game) {
  @{ Game = $Game } | ConvertTo-Json | Set-Content $configFile -Encoding UTF8
} elseif (Test-Path $configFile) {
  $Game = (Get-Content $configFile -Raw | ConvertFrom-Json).Game
} else {
  Fail 'Tell me where the game is the first time: .\tools\update.ps1 -Game "C:\path\to\Universal Gold"'
}

$pbs = Join-Path $Game 'PBS'
if (-not (Test-Path $pbs)) { Fail "PBS folder not found: $pbs" }

Step 'Converting PBS files'
node tools/convert_pbs.js $pbs
if ($LASTEXITCODE -ne 0) { Fail 'The PBS converter failed (see the message above).' }

if (-not $SkipIcons) {
  Step 'Copying icons'
  & (Join-Path $PSScriptRoot 'copy_icons.ps1') -Game $Game
  if ($LASTEXITCODE -ne 0) { Fail 'Copying icons failed (see the message above).' }
}

Step 'Building the calc'
node build
if ($LASTEXITCODE -ne 0) { Fail 'The build failed (see the errors above).' }

Step 'Saving to git'
git add -A
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Write-Host 'No changes since the last update, so there is nothing to publish.' -ForegroundColor Yellow
  exit 0
}
if (-not $Message) { $Message = "Update from PBS ($(Get-Date -Format 'yyyy-MM-dd HH:mm'))" }
git commit -m $Message
if ($LASTEXITCODE -ne 0) { Fail 'git commit failed (see the message above).' }

if ($NoPush) {
  Write-Host "`nCommitted. Run 'git push' when you're ready to publish." -ForegroundColor Green
  exit 0
}

Step 'Publishing'
git push
if ($LASTEXITCODE -ne 0) {
  Write-Host "`nThe commit is saved, but the push failed. Fix the problem above, then run 'git push'." -ForegroundColor Red
  exit 1
}

Write-Host "`nDone! The live site updates in about a minute." -ForegroundColor Green
