$ErrorActionPreference = "Stop"
$dir = "$env:LOCALAPPDATA\CRVO\PresenceBridge"
$configPath = Join-Path $dir "config.json"
$scriptPath = Join-Path $dir "crvo-presence-bridge.ps1"

if (!(Test-Path $configPath)) {
  throw "Configuration CRVO absente. Relance l'installateur V4/V5 complet pour valider la connexion SQL."
}
if (!(Test-Path $scriptPath)) {
  $rawUrl = "https://raw.githubusercontent.com/Velvet-Application/CRVO/main/bridge/windows/presence/crvo-presence-bridge.ps1"
  Invoke-WebRequest -Uri $rawUrl -OutFile $scriptPath -UseBasicParsing
}

Write-Host "Connexion SQL deja validee. Reprise de l'installation..." -ForegroundColor Green
$taskName = "CRVO - Presence SQL"
$taskCommand = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $scriptPath + '" -ConfigPath "' + $configPath + '"'

$previousErrorActionPreference = $ErrorActionPreference
try {
  $ErrorActionPreference = "SilentlyContinue"
  & schtasks.exe /Delete /TN $taskName /F 2>$null | Out-Null
} finally {
  $ErrorActionPreference = $previousErrorActionPreference
}

& schtasks.exe /Create /TN $taskName /SC MINUTE /MO 15 /TR $taskCommand /RL LIMITED /IT /F | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Impossible de creer la tache planifiee Windows." }

Write-Host "Tache planifiee creee." -ForegroundColor Green
Write-Host "Chargement historique initial depuis novembre 2024..." -ForegroundColor Cyan
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath -ConfigPath $configPath -Full
if ($LASTEXITCODE -ne 0) { throw "Le chargement initial a echoue. Consulte $dir\presence-bridge.log" }

Write-Host ""
Write-Host "INSTALLATION TERMINEE" -ForegroundColor Green
Write-Host "Synchronisation automatique toutes les 15 minutes." -ForegroundColor Green
Write-Host "Journal : $dir\presence-bridge.log"
