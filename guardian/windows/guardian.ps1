param(
  [Parameter(Mandatory=$true)][string]$ConfigPath
)

$ErrorActionPreference = "Stop"
$cfg = Get-Content -Raw -Path $ConfigPath | ConvertFrom-Json
$SupabaseUrl = ([string]$cfg.supabaseUrl).TrimEnd('/')
$TargetKey = [string]$cfg.targetKey
$Token = [string]$cfg.token
$ScreenUrl = [string]$cfg.screenUrl
$BrowserPath = [string]$cfg.browserPath
$AllowReboot = [bool]$cfg.allowReboot
$Gateway = "$SupabaseUrl/functions/v1/kpi-maintenance-gateway"

if ($TargetKey -notmatch '^screen\.(atelier|direction)$') { throw "TargetKey invalide." }
if ($Token -notmatch '^[0-9a-fA-F]{64}$') { throw "Jeton Guardian invalide." }
if (-not (Test-Path $BrowserPath)) { throw "Navigateur introuvable: $BrowserPath" }

function Write-GuardianLog([string]$Event, [hashtable]$Details=@{}) {
  $payload = @{ timestamp=(Get-Date).ToUniversalTime().ToString('o'); service='crvo-guardian-windows'; event=$Event; target=$TargetKey }
  foreach ($key in $Details.Keys) { $payload[$key] = $Details[$key] }
  Write-Output ($payload | ConvertTo-Json -Compress -Depth 6)
}

function Invoke-Gateway([string]$Action, [hashtable]$Body) {
  $headers = @{ 'x-kpi-guardian-token'=$Token }
  $json = $Body | ConvertTo-Json -Compress -Depth 8
  return Invoke-RestMethod -Method Post -Uri "$Gateway?action=guardian-$Action" -Headers $headers -ContentType 'application/json' -Body $json -TimeoutSec 20
}

function Report-Result($Command, [bool]$Ok, [hashtable]$Result=@{}, [string]$ErrorText='') {
  try {
    Invoke-Gateway 'result' @{
      targetKey=$TargetKey; mode='native'; appVersion='windows-guardian-v1'; commandId=[string]$Command.id;
      ok=$Ok; result=$Result; error=($(if($ErrorText){$ErrorText}else{$null}));
      details=@{ machine=$env:COMPUTERNAME; user=$env:USERNAME }
    } | Out-Null
  } catch { Write-GuardianLog 'result_report_failed' @{ message=$_.Exception.Message } }
}

function Restart-Browser {
  $browserName = [System.IO.Path]::GetFileNameWithoutExtension($BrowserPath)
  Get-Process -Name $browserName -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  $arguments = if ($browserName -match 'msedge') { @('--kiosk', $ScreenUrl, '--edge-kiosk-type=fullscreen', '--no-first-run') } else { @('--kiosk', $ScreenUrl, '--no-first-run') }
  Start-Process -FilePath $BrowserPath -ArgumentList $arguments
}

Write-GuardianLog 'guardian_started' @{ browser=$BrowserPath; screen=$ScreenUrl; allowReboot=$AllowReboot }

while ($true) {
  try {
    $response = Invoke-Gateway 'claim' @{
      targetKey=$TargetKey; mode='native'; appVersion='windows-guardian-v1';
      details=@{ machine=$env:COMPUTERNAME; os=[Environment]::OSVersion.VersionString; screenUrl=$ScreenUrl }
    }
    $command = $response.command
    if ($null -ne $command) {
      Write-GuardianLog 'command_claimed' @{ commandId=[string]$command.id; action=[string]$command.action }
      try {
        switch ([string]$command.action) {
          'restart_browser' {
            Restart-Browser
            Report-Result $command $true @{ action='restart_browser'; restarted=$true }
          }
          'restart_guardian' {
            Report-Result $command $true @{ action='restart_guardian'; exiting=$true }
            Write-GuardianLog 'guardian_restart_requested'
            exit 75
          }
          'reboot_device' {
            if (-not $AllowReboot) { throw "Redémarrage du poste non autorisé dans la configuration Guardian." }
            Report-Result $command $true @{ action='reboot_device'; rebootScheduled=$true }
            Write-GuardianLog 'device_reboot_requested'
            Start-Process -FilePath "$env:SystemRoot\System32\shutdown.exe" -ArgumentList @('/r','/t','5','/f') -WindowStyle Hidden
            Start-Sleep -Seconds 10
          }
          default { throw "Action native non prise en charge: $($command.action)" }
        }
      } catch {
        $message = $_.Exception.Message
        Report-Result $command $false @{} $message
        Write-GuardianLog 'command_failed' @{ commandId=[string]$command.id; action=[string]$command.action; message=$message }
      }
    }
  } catch {
    Write-GuardianLog 'poll_failed' @{ message=$_.Exception.Message }
  }
  Start-Sleep -Seconds 15
}
