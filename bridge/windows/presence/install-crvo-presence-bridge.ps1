param([string]$SourcePath)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Protect-String([string]$Value) {
  $secure = ConvertTo-SecureString $Value -AsPlainText -Force
  return ConvertFrom-SecureString $secure
}

function Normalize-Connection([object]$Value) {
  if ($null -eq $Value) { return $null }
  $text = if ($Value -is [System.Array]) { ($Value -join "") } else { [string]$Value }
  if ([string]::IsNullOrWhiteSpace($text)) { return $null }
  $text = [System.Net.WebUtility]::HtmlDecode($text.Trim())
  if ($text.StartsWith("ODBC;", [StringComparison]::OrdinalIgnoreCase)) { $text = $text.Substring(5) }
  return $text
}

function Is-IcareConnection([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return $false }
  return ($Value -match '(?i)(?:^|;)SERVER\s*=') -and ($Value -match '(?i)(?:^|;)DATABASE\s*=\s*IcareCRVO(?:;|$)')
}

function Get-OdcConnection([string]$Path) {
  if (!(Test-Path $Path)) { return $null }
  try {
    [xml]$xml = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    $nodes = $xml.SelectNodes("//*[local-name()='ConnectionString']")
    foreach ($node in $nodes) {
      $candidate = Normalize-Connection $node.InnerText
      if (Is-IcareConnection $candidate) { return $candidate }
    }
  } catch {}
  try {
    $raw = Get-Content -LiteralPath $Path -Raw
    $matches = [regex]::Matches($raw, '(?is)<(?:\w+:)?ConnectionString[^>]*>(.*?)</(?:\w+:)?ConnectionString>')
    foreach ($match in $matches) {
      $candidate = Normalize-Connection $match.Groups[1].Value
      if (Is-IcareConnection $candidate) { return $candidate }
    }
  } catch {}
  return $null
}

function Get-WorkbookXmlConnection([string]$Path) {
  if ([IO.Path]::GetExtension($Path) -notmatch '(?i)^\.(xlsx|xlsm|xlsb)$') { return $null }
  $temp = Join-Path $env:TEMP ("crvo-presence-" + [guid]::NewGuid().ToString("N"))
  try {
    [IO.Compression.ZipFile]::ExtractToDirectory($Path, $temp)
    $files = Get-ChildItem -Path $temp -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -in '.xml','.rels' }
    foreach ($file in $files) {
      $raw = Get-Content -LiteralPath $file.FullName -Raw -ErrorAction SilentlyContinue
      if (!$raw -or $raw -notmatch '(?i)IcareCRVO') { continue }
      $decoded = [System.Net.WebUtility]::HtmlDecode($raw)
      $matches = [regex]::Matches($decoded, '(?i)(?:ODBC;)?DRIVER\s*=.*?DATABASE\s*=\s*IcareCRVO[^"''<>\r\n]*')
      foreach ($match in $matches) {
        $candidate = Normalize-Connection $match.Value
        if (Is-IcareConnection $candidate) { return $candidate }
      }
    }
  } catch {} finally {
    if (Test-Path $temp) { Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue }
  }
  return $null
}

function Get-ExcelConnection([string]$Path) {
  $excel = $null; $workbook = $null
  $found = $null
  try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $workbook = $excel.Workbooks.Open($Path, 0, $true)

    foreach ($item in @($workbook.Connections)) {
      $candidates = New-Object System.Collections.Generic.List[object]
      try { $candidates.Add($item.ODBCConnection.Connection) } catch {}
      try { $candidates.Add($item.OLEDBConnection.Connection) } catch {}
      foreach ($value in $candidates) {
        $candidate = Normalize-Connection $value
        if (Is-IcareConnection $candidate) { $found = $candidate; break }
      }
      if ($found) { break }
    }

    if (!$found) {
      foreach ($sheet in @($workbook.Worksheets)) {
        try {
          foreach ($qt in @($sheet.QueryTables)) {
            $candidate = Normalize-Connection $qt.Connection
            if (Is-IcareConnection $candidate) { $found = $candidate; break }
          }
        } catch {}
        if ($found) { break }
        try {
          foreach ($list in @($sheet.ListObjects)) {
            try {
              $candidate = Normalize-Connection $list.QueryTable.Connection
              if (Is-IcareConnection $candidate) { $found = $candidate; break }
            } catch {}
          }
        } catch {}
        if ($found) { break }
      }
    }
  } catch {
    Write-Host "Lecture Excel directe impossible, tentative via les fichiers de connexion..." -ForegroundColor Yellow
  } finally {
    if ($workbook) { try { $workbook.Close($false) | Out-Null } catch {} }
    if ($excel) { try { $excel.Quit() | Out-Null } catch {} }
    if ($workbook) { try { [Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) | Out-Null } catch {} }
    if ($excel) { try { [Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null } catch {} }
    [GC]::Collect(); [GC]::WaitForPendingFinalizers()
  }
  if ($found) { return $found }
  return Get-WorkbookXmlConnection $Path
}

function Search-NearbyOdc([string]$InitialPath) {
  $roots = New-Object System.Collections.Generic.List[string]
  if ($InitialPath) { $roots.Add((Split-Path -Parent $InitialPath)) }
  foreach ($root in @(
    [Environment]::GetFolderPath('MyDocuments'),
    [Environment]::GetFolderPath('Desktop'),
    (Join-Path $env:USERPROFILE 'Downloads'),
    (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'My Data Sources'),
    (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Mes sources de données')
  )) { if ($root -and (Test-Path $root) -and !$roots.Contains($root)) { $roots.Add($root) } }

  foreach ($root in $roots) {
    try {
      $files = Get-ChildItem -LiteralPath $root -Filter *.odc -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 50
      foreach ($file in $files) {
        $candidate = Get-OdcConnection $file.FullName
        if ($candidate) { return @{ Connection=$candidate; Path=$file.FullName } }
      }
    } catch {}
  }
  return $null
}

function Pick-Source([string]$Title, [string]$Filter) {
  $dialog = New-Object System.Windows.Forms.OpenFileDialog
  $dialog.Title = $Title
  $dialog.Filter = $Filter
  if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { return $null }
  return $dialog.FileName
}

if (!$SourcePath) {
  $SourcePath = Pick-Source "Sélectionne le fichier Présentéisme Excel OU son fichier de connexion ODC" "Excel / connexion (*.xlsx;*.xlsm;*.xlsb;*.xls;*.odc)|*.xlsx;*.xlsm;*.xlsb;*.xls;*.odc|Tous les fichiers (*.*)|*.*"
}
if (!$SourcePath) { throw "Installation annulée." }
if (!(Test-Path $SourcePath)) { throw "Fichier introuvable : $SourcePath" }

Write-Host "Recherche de la connexion SQL iCare..." -ForegroundColor Cyan
$connection = $null
$actualSource = $SourcePath
if ([IO.Path]::GetExtension($SourcePath) -ieq '.odc') {
  $connection = Get-OdcConnection $SourcePath
} else {
  $connection = Get-ExcelConnection $SourcePath
}

if (!$connection) {
  Write-Host "La connexion n'est pas exposée directement par le classeur. Recherche automatique du fichier .odc associé..." -ForegroundColor Yellow
  $nearby = Search-NearbyOdc $SourcePath
  if ($nearby) {
    $connection = [string]$nearby.Connection
    $actualSource = [string]$nearby.Path
  }
}

if (!$connection) {
  Write-Host "Je n'ai pas trouvé automatiquement le fichier de connexion. Sélectionne maintenant le fichier .odc utilisé par Excel." -ForegroundColor Yellow
  $odc = Pick-Source "Sélectionne le fichier de connexion .ODC d'iCare" "Fichier de connexion Office (*.odc)|*.odc|Tous les fichiers (*.*)|*.*"
  if ($odc) {
    $connection = Get-OdcConnection $odc
    if ($connection) { $actualSource = $odc }
  }
}

if (!$connection) {
  throw "Connexion SQL iCare introuvable. Ouvre Excel > Données > Connexions > Propriétés > Définition et repère le fichier de connexion .odc, puis relance cet installateur et sélectionne directement ce .odc."
}
if ($connection -notmatch '(?i)(?:^|;)PWD=[^;]+') {
  throw "Connexion iCare trouvée, mais le mot de passe SQL n'est pas enregistré dans cette source. Dans Excel, coche 'Enregistrer le mot de passe', actualise une fois le fichier, enregistre-le puis relance l'installation."
}

# Validation réelle avant installation : aucune donnée sensible n'est affichée.
Write-Host "Connexion trouvée. Test d'accès SQL en lecture seule..." -ForegroundColor Cyan
$testConnection = New-Object System.Data.Odbc.OdbcConnection($connection)
try {
  $testConnection.Open()
  $cmd = $testConnection.CreateCommand()
  $cmd.CommandTimeout = 20
  $cmd.CommandText = "SELECT TOP 1 Pres.Fecha FROM tgPresencia AS Pres WHERE Pres.CodigoTiempo <> 'P' ORDER BY Pres.Fecha DESC"
  $null = $cmd.ExecuteScalar()
} catch {
  throw "Connexion détectée mais le test SQL a échoué : $($_.Exception.Message)"
} finally {
  if ($testConnection.State -ne [Data.ConnectionState]::Closed) { $testConnection.Close() }
  $testConnection.Dispose()
}
Write-Host "Test SQL OK." -ForegroundColor Green

$dir = "$env:LOCALAPPDATA\CRVO\PresenceBridge"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$scriptPath = Join-Path $dir "crvo-presence-bridge.ps1"
$configPath = Join-Path $dir "config.json"
$rawUrl = "https://raw.githubusercontent.com/Velvet-Application/CRVO/main/bridge/windows/presence/crvo-presence-bridge.ps1"
Invoke-WebRequest -Uri $rawUrl -OutFile $scriptPath -UseBasicParsing

$config = [ordered]@{
  encryptedConnection = Protect-String $connection
  endpoint = "https://tvmkhvfmdstkunwwuzuz.supabase.co/functions/v1/kpi-sql-presence-ingest"
  source = $actualSource
  installedAt = (Get-Date).ToUniversalTime().ToString("o")
}
$config | ConvertTo-Json | Set-Content -Path $configPath -Encoding UTF8

$taskName = "CRVO - Présentéisme SQL"
$taskCommand = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $scriptPath + '" -ConfigPath "' + $configPath + '"'
& schtasks.exe /Delete /TN $taskName /F 2>$null | Out-Null
& schtasks.exe /Create /TN $taskName /SC MINUTE /MO 15 /TR $taskCommand /RL LIMITED /IT /F | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Impossible de créer la tâche planifiée Windows." }

Write-Host "Connexion iCare stockée localement avec chiffrement Windows DPAPI." -ForegroundColor Green
Write-Host "Chargement historique initial depuis novembre 2024..." -ForegroundColor Cyan
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath -ConfigPath $configPath -Full
if ($LASTEXITCODE -ne 0) { throw "Le chargement initial a échoué. Consulte $dir\presence-bridge.log" }

Write-Host ""
Write-Host "INSTALLATION TERMINÉE" -ForegroundColor Green
Write-Host "Présentéisme SQL synchronisé automatiquement toutes les 15 minutes tant que cette session Windows est ouverte." -ForegroundColor Green
Write-Host "Journal : $dir\presence-bridge.log"
