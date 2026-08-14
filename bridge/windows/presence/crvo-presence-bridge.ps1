param(
  [string]$ConfigPath = "$env:LOCALAPPDATA\CRVO\PresenceBridge\config.json",
  [switch]$Full
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-BridgeLog([string]$Message) {
  $dir = Split-Path -Parent $ConfigPath
  if (!(Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
  Add-Content -Path (Join-Path $dir "presence-bridge.log") -Value $line -Encoding UTF8
}

function Unprotect-String([string]$Encrypted) {
  $secure = ConvertTo-SecureString $Encrypted
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Sha256-Hex([string]$Text) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
    return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-","").ToLowerInvariant()
  } finally { $sha.Dispose() }
}

if (!(Test-Path $ConfigPath)) { throw "Configuration CRVO introuvable : $ConfigPath" }
$config = Get-Content $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$connectionString = Unprotect-String ([string]$config.encryptedConnection)
$endpoint = [string]$config.endpoint
if (!$connectionString -or !$endpoint) { throw "Configuration CRVO incomplète." }
if ($connectionString.StartsWith("ODBC;", [StringComparison]::OrdinalIgnoreCase)) { $connectionString = $connectionString.Substring(5) }

$pwdMatch = [regex]::Match($connectionString, '(?i)(?:^|;)PWD=([^;]+)')
if (!$pwdMatch.Success) { throw "Le mot de passe SQL enregistré dans la connexion Excel est introuvable." }
$bridgeToken = Sha256-Hex ("crvo-presence-bridge:v1:" + $pwdMatch.Groups[1].Value)

$fromDate = if ($Full) { [datetime]::ParseExact("2024-11-02","yyyy-MM-dd",$null) } else { (Get-Date).Date.AddDays(-60) }
$fromIso = $fromDate.ToString("yyyy-MM-dd")
$startedAt = (Get-Date).ToUniversalTime().ToString("o")
$mode = if ($Full) { "full" } else { "incremental" }

$query = @"
SELECT
  CONVERT(date, Pres.Fecha) AS work_date,
  CAST(Pres.CodigoTiempo AS varchar(80)) AS time_code,
  CAST(Code.Descrip AS nvarchar(300)) AS time_description,
  CONVERT(decimal(12,2), Pres.Tiempo) AS time_value,
  CAST(Mec.Nombre AS nvarchar(300)) AS mechanic_name
FROM tgPresencia AS Pres
LEFT JOIN ttCodigoTiempo AS Code ON Pres.CodigoTiempo = Code.Codigo
LEFT JOIN ttMecanico AS Mec ON Pres.Usuario = Mec.Mecanico
WHERE Pres.CodigoTiempo <> 'P'
  AND Pres.Fecha >= CONVERT(date, '$fromIso', 23)
ORDER BY Pres.Fecha, Mec.Nombre, Pres.CodigoTiempo;
"@

Write-BridgeLog "Démarrage synchro $mode depuis $fromIso"
$conn = New-Object System.Data.Odbc.OdbcConnection($connectionString)
$rows = New-Object System.Collections.Generic.List[object]
try {
  $conn.Open()
  $cmd = $conn.CreateCommand()
  $cmd.CommandTimeout = 120
  $cmd.CommandText = $query
  $reader = $cmd.ExecuteReader()
  $occurrences = @{}
  while ($reader.Read()) {
    $workDate = ([datetime]$reader.GetValue(0)).ToString("yyyy-MM-dd")
    $code = if ($reader.IsDBNull(1)) { $null } else { [string]$reader.GetValue(1) }
    $description = if ($reader.IsDBNull(2)) { $null } else { [string]$reader.GetValue(2) }
    $timeValue = if ($reader.IsDBNull(3)) { 0.0 } else { [math]::Round([double]$reader.GetValue(3),2) }
    $mechanic = if ($reader.IsDBNull(4)) { $null } else { [string]$reader.GetValue(4) }
    $base = "$workDate|$code|$description|$($timeValue.ToString('0.00',[Globalization.CultureInfo]::InvariantCulture))|$mechanic"
    $occ = if ($occurrences.ContainsKey($base)) { [int]$occurrences[$base] + 1 } else { 1 }
    $occurrences[$base] = $occ
    $hash = Sha256-Hex "$base|$occ"
    $rows.Add([pscustomobject]@{
      source_row_hash = $hash
      work_date = $workDate
      time_code = $code
      time_description = $description
      time_value = $timeValue
      mechanic_name = $mechanic
    })
  }
  $reader.Close()
} finally {
  if ($conn.State -ne [Data.ConnectionState]::Closed) { $conn.Close() }
  $conn.Dispose()
}

$headers = @{ "x-crvo-presence-bridge-token" = $bridgeToken }
$chunkSize = 500
if ($rows.Count -eq 0) {
  $body = @{ fromDate=$fromIso; reset=$true; complete=$true; mode=$mode; startedAt=$startedAt; rows=@() } | ConvertTo-Json -Depth 6
  Invoke-RestMethod -Uri $endpoint -Method Post -ContentType "application/json" -Headers $headers -Body $body | Out-Null
} else {
  for ($offset=0; $offset -lt $rows.Count; $offset += $chunkSize) {
    $end = [math]::Min($offset + $chunkSize - 1, $rows.Count - 1)
    $chunk = @($rows[$offset..$end])
    $body = @{
      fromDate = $fromIso
      reset = ($offset -eq 0)
      complete = ($end -eq $rows.Count - 1)
      mode = $mode
      startedAt = $startedAt
      rows = $chunk
    } | ConvertTo-Json -Depth 8 -Compress
    Invoke-RestMethod -Uri $endpoint -Method Post -ContentType "application/json" -Headers $headers -Body $body | Out-Null
  }
}

Write-BridgeLog "Synchro $mode terminée : $($rows.Count) ligne(s) depuis $fromIso"
Write-Output "CRVO Présentéisme synchronisé : $($rows.Count) ligne(s)."
