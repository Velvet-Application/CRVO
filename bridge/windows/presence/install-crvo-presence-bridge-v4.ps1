param([string]$SourcePath)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms

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

function Looks-LikeOdbc([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return $false }
  return ($Value -match '(?i)(?:^|;)(DSN|DRIVER|SERVER)\s*=')
}

function Test-PresenceConnection([string]$ConnectionString) {
  if (!(Looks-LikeOdbc $ConnectionString)) { return $false }
  $conn = $null
  try {
    $conn = New-Object System.Data.Odbc.OdbcConnection($ConnectionString)
    $conn.Open()
    $cmd = $conn.CreateCommand()
    $cmd.CommandTimeout = 20
    $cmd.CommandText = "SELECT TOP 1 Pres.Fecha FROM tgPresencia AS Pres WHERE Pres.CodigoTiempo <> 'P' ORDER BY Pres.Fecha DESC"
    $null = $cmd.ExecuteScalar()
    return $true
  } catch {
    return $false
  } finally {
    if ($conn) {
      try { if ($conn.State -ne [Data.ConnectionState]::Closed) { $conn.Close() } } catch {}
      try { $conn.Dispose() } catch {}
    }
  }
}

function Add-Candidate([System.Collections.Generic.List[string]]$List, [object]$Value) {
  $candidate = Normalize-Connection $Value
  if (!(Looks-LikeOdbc $candidate)) { return }
  if (!$List.Contains($candidate)) { $List.Add($candidate) }
}

function Get-ExcelCandidates([string]$Path) {
  $list = New-Object 'System.Collections.Generic.List[string]'
  $excel = $null; $workbook = $null
  try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $workbook = $excel.Workbooks.Open($Path, 0, $true)

    foreach ($item in @($workbook.Connections)) {
      try { Add-Candidate $list $item.ODBCConnection.Connection } catch {}
      try { Add-Candidate $list $item.OLEDBConnection.Connection } catch {}
    }

    foreach ($sheet in @($workbook.Worksheets)) {
      try {
        foreach ($qt in @($sheet.QueryTables)) {
          try { Add-Candidate $list $qt.Connection } catch {}
        }
      } catch {}
      try {
        foreach ($lo in @($sheet.ListObjects)) {
          try { Add-Candidate $list $lo.QueryTable.Connection } catch {}
        }
      } catch {}
    }
  } finally {
    if ($workbook) { try { $workbook.Close($false) | Out-Null } catch {} }
    if ($excel) { try { $excel.Quit() | Out-Null } catch {} }
    if ($workbook) { try { [Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) | Out-Null } catch {} }
    if ($excel) { try { [Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null } catch {} }
    [GC]::Collect(); [GC]::WaitForPendingFinalizers()
  }
  return $list
}

function Get-TextFileCandidates([string]$Path) {
  $list = New-Object 'System.Collections.Generic.List[string]'
  try {
    $raw = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
    $decoded = [System.Net.WebUtility]::HtmlDecode($raw)

    foreach ($match in [regex]::Matches($decoded, '(?is)<(?:\w+:)?ConnectionString[^>]*>(.*?)</(?:\w+:)?ConnectionString>')) {
      Add-Candidate $list $match.Groups[1].Value
    }

    foreach ($line in ($decoded -split "`r?`n")) {
      if ($line -match '(?i)^\s*(ODBC;)?(DSN|DRIVER|SERVER)\s*=') { Add-Candidate $list $line }
    }

    $joined = ($decoded -split "`r?`n" | Where-Object { $_ -match '(?i)^\s*(DSN|DRIVER|SERVER|DATABASE|UID|PWD|Trusted_Connection)\s*=' }) -join ';'
    Add-Candidate $list $joined
  } catch {}
  return $list
}

function Get-DsnCandidates {
  $list = New-Object 'System.Collections.Generic.List[string]'
  try {
    Import-Module Wdac -ErrorAction SilentlyContinue
    foreach ($dsn in @(Get-OdbcDsn -ErrorAction SilentlyContinue)) {
      $name = [string]$dsn.Name
      if ([string]::IsNullOrWhiteSpace($name)) { continue }
      $candidate = "DSN=$name;"
      if ($dsn.Attribute) {
        foreach ($attr in @($dsn.Attribute)) {
          if ($attr -match '^(?<k>[^=]+)=(?<v>.*)$') {
            $k = $matches.k; $v = $matches.v
            if ($k -match '(?i)^(SERVER|DATABASE|UID|PWD|Trusted_Connection)$') { $candidate += "$k=$v;" }
          }
        }
      }
      Add-Candidate $list $candidate
    }
  } catch {}
  return $list
}

function Find-WorkingConnection([System.Collections.Generic.List[string]]$Candidates) {
  $index = 0
  foreach ($candidate in $Candidates) {
    $index++
    Write-Host ("Test connexion candidate {0}/{1}..." -f $index, $Candidates.Count)
    if (Test-PresenceConnection $candidate) { return $candidate }
  }
  return $null
}

function Pick-File([string]$Title, [string]$Filter) {
  $dialog = New-Object System.Windows.Forms.OpenFileDialog
  $dialog.Title = $Title
  $dialog.Filter = $Filter
  if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { return $null }
  return $dialog.FileName
}

if (!$SourcePath) {
  $SourcePath = Pick-File "Selectionner le fichier Excel Presenteisme" "Excel (*.xlsx;*.xlsm;*.xlsb;*.xls)|*.xlsx;*.xlsm;*.xlsb;*.xls|Tous les fichiers (*.*)|*.*"
}
if (!$SourcePath) { throw "Installation annulee." }
if (!(Test-Path $SourcePath)) { throw "Fichier introuvable." }

Write-Host "Recherche de la connexion SQL iCare dans Excel..." -ForegroundColor Cyan
$candidates = Get-ExcelCandidates $SourcePath
Write-Host ("{0} connexion(s) ODBC detectee(s) dans Excel." -f $candidates.Count)
$connection = Find-WorkingConnection $candidates
$actualSource = $SourcePath

if (!$connection) {
  Write-Host "Aucune connexion Excel exploitable. Recherche des DSN ODBC Windows..." -ForegroundColor Yellow
  $dsnCandidates = Get-DsnCandidates
  foreach ($c in $dsnCandidates) { if (!$candidates.Contains($c)) { $candidates.Add($c) } }
  $connection = Find-WorkingConnection $dsnCandidates
}

if (!$connection) {
  Write-Host "Recherche des fichiers de connexion ODC/DQY/DSN..." -ForegroundColor Yellow
  $roots = @(
    (Split-Path -Parent $SourcePath),
    [Environment]::GetFolderPath('MyDocuments'),
    [Environment]::GetFolderPath('Desktop'),
    (Join-Path $env:USERPROFILE 'Downloads')
  ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique

  foreach ($root in $roots) {
    foreach ($file in @(Get-ChildItem -LiteralPath $root -File -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Extension -match '(?i)^\.(odc|dqy|dsn)$' } | Select-Object -First 100)) {
      foreach ($c in (Get-TextFileCandidates $file.FullName)) {
        if (Test-PresenceConnection $c) {
          $connection = $c
          $actualSource = $file.FullName
          break
        }
      }
      if ($connection) { break }
    }
    if ($connection) { break }
  }
}

if (!$connection) {
  Write-Host "Detection automatique impossible. Selectionne un fichier ODC, DQY ou DSN si tu en vois un." -ForegroundColor Yellow
  $manual = Pick-File "Selectionner un fichier de connexion" "Connexions (*.odc;*.dqy;*.dsn)|*.odc;*.dqy;*.dsn|Tous les fichiers (*.*)|*.*"
  if ($manual) {
    foreach ($c in (Get-TextFileCandidates $manual)) {
      if (Test-PresenceConnection $c) {
        $connection = $c
        $actualSource = $manual
        break
      }
    }
  }
}

if (!$connection) {
  throw "Aucune connexion SQL iCare exploitable n'a ete trouvee. Cette version a teste les connexions Excel, les QueryTables, les DSN Windows et les fichiers ODC/DQY/DSN."
}

if ($connection -notmatch '(?i)(?:^|;)PWD=[^;]+') {
  throw "La connexion SQL fonctionne mais le mot de passe n'est pas present dans la chaine de connexion. Le pont securise actuel a besoin du mot de passe enregistre localement pour s'authentifier aupres de Supabase."
}

Write-Host "Connexion SQL iCare validee." -ForegroundColor Green
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

$taskName = "CRVO - Presence SQL"
$taskCommand = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $scriptPath + '" -ConfigPath "' + $configPath + '"'

# The first install legitimately has no existing task. schtasks writes that case to STDERR;
# with ErrorActionPreference=Stop PowerShell treated it as a fatal NativeCommandError.
# Ignore only the delete-if-present step, then enforce success on task creation.
$previousErrorActionPreference = $ErrorActionPreference
try {
  $ErrorActionPreference = "SilentlyContinue"
  & schtasks.exe /Delete /TN $taskName /F 2>$null | Out-Null
} finally {
  $ErrorActionPreference = $previousErrorActionPreference
}

& schtasks.exe /Create /TN $taskName /SC MINUTE /MO 15 /TR $taskCommand /RL LIMITED /IT /F | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Impossible de creer la tache planifiee Windows." }

Write-Host "Tache planifiee Windows creee." -ForegroundColor Green
Write-Host "Connexion stockee localement avec chiffrement Windows DPAPI." -ForegroundColor Green
Write-Host "Chargement historique initial depuis novembre 2024..." -ForegroundColor Cyan
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath -ConfigPath $configPath -Full
if ($LASTEXITCODE -ne 0) { throw "Le chargement initial a echoue. Consulte le journal PresenceBridge." }

Write-Host ""
Write-Host "INSTALLATION TERMINEE" -ForegroundColor Green
Write-Host "Synchronisation automatique toutes les 15 minutes." -ForegroundColor Green
Write-Host ("Journal : {0}" -f (Join-Path $dir 'presence-bridge.log'))
