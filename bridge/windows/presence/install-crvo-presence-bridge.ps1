param([string]$WorkbookPath)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms

function Protect-String([string]$Value) {
  $secure = ConvertTo-SecureString $Value -AsPlainText -Force
  return ConvertFrom-SecureString $secure
}

if (!$WorkbookPath) {
  $dialog = New-Object System.Windows.Forms.OpenFileDialog
  $dialog.Title = "Sélectionner le fichier Excel Présentéisme déjà connecté à iCare"
  $dialog.Filter = "Fichiers Excel (*.xlsx;*.xlsm;*.xlsb;*.xls)|*.xlsx;*.xlsm;*.xlsb;*.xls|Tous les fichiers (*.*)|*.*"
  if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { throw "Installation annulée." }
  $WorkbookPath = $dialog.FileName
}
if (!(Test-Path $WorkbookPath)) { throw "Fichier Excel introuvable : $WorkbookPath" }

$excel = $null; $workbook = $null; $connection = $null
try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $workbook = $excel.Workbooks.Open($WorkbookPath, 0, $true)
  foreach ($item in $workbook.Connections) {
    $candidate = $null
    try { $candidate = [string]$item.ODBCConnection.Connection } catch {}
    if (!$candidate) { try { $candidate = [string]$item.OLEDBConnection.Connection } catch {} }
    if ($candidate -and $candidate -match '(?i)IcareCRVO' -and $candidate -match '(?i)SERVER=') { $connection = $candidate; break }
  }
} finally {
  if ($workbook) { $workbook.Close($false) | Out-Null }
  if ($excel) { $excel.Quit() | Out-Null }
  if ($workbook) { [Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) | Out-Null }
  if ($excel) { [Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}

if (!$connection) { throw "Connexion SQL iCare introuvable dans le classeur sélectionné." }
if ($connection.StartsWith("ODBC;", [StringComparison]::OrdinalIgnoreCase)) { $connection = $connection.Substring(5) }
if ($connection -notmatch '(?i)PWD=[^;]+') { throw "Le classeur ne restitue pas le mot de passe SQL enregistré. Vérifie que 'Enregistrer le mot de passe' est activé dans les propriétés de connexion Excel." }

$dir = "$env:LOCALAPPDATA\CRVO\PresenceBridge"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$scriptPath = Join-Path $dir "crvo-presence-bridge.ps1"
$configPath = Join-Path $dir "config.json"
$rawUrl = "https://raw.githubusercontent.com/Velvet-Application/CRVO/main/bridge/windows/presence/crvo-presence-bridge.ps1"
Invoke-WebRequest -Uri $rawUrl -OutFile $scriptPath -UseBasicParsing

$config = [ordered]@{
  encryptedConnection = Protect-String $connection
  endpoint = "https://tvmkhvfmdstkunwwuzuz.supabase.co/functions/v1/kpi-sql-presence-ingest"
  workbook = $WorkbookPath
  installedAt = (Get-Date).ToUniversalTime().ToString("o")
}
$config | ConvertTo-Json | Set-Content -Path $configPath -Encoding UTF8

$taskName = "CRVO - Présentéisme SQL"
$taskCommand = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $scriptPath + '" -ConfigPath "' + $configPath + '"'
& schtasks.exe /Delete /TN $taskName /F 2>$null | Out-Null
& schtasks.exe /Create /TN $taskName /SC MINUTE /MO 15 /TR $taskCommand /RL LIMITED /IT /F | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Impossible de créer la tâche planifiée Windows." }

Write-Host "Connexion iCare détectée et stockée localement avec chiffrement Windows DPAPI." -ForegroundColor Green
Write-Host "Lancement du chargement historique initial..." -ForegroundColor Cyan
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath -ConfigPath $configPath -Full
if ($LASTEXITCODE -ne 0) { throw "Le chargement initial a échoué. Consulte $dir\presence-bridge.log" }

Write-Host ""; Write-Host "CRVO Présentéisme est maintenant synchronisé automatiquement toutes les 15 minutes tant que cette session Windows est ouverte." -ForegroundColor Green
Write-Host "Journal : $dir\presence-bridge.log"
