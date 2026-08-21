param(
  [Parameter(Mandatory=$true)][ValidateSet('screen.atelier','screen.direction')][string]$TargetKey,
  [Parameter(Mandatory=$true)][string]$Token,
  [Parameter(Mandatory=$true)][string]$ScreenUrl,
  [string]$SupabaseUrl='https://tvmkhvfmdstkunwwuzuz.supabase.co',
  [string]$BrowserPath='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
  [switch]$AllowReboot
)

$ErrorActionPreference='Stop'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=New-Object Security.Principal.WindowsPrincipal($identity)
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){ throw 'Lance ce script en PowerShell Administrateur.' }
if($Token -notmatch '^[0-9a-fA-F]{64}$'){ throw 'Jeton Guardian invalide.' }
if(-not (Test-Path $BrowserPath)){
  $fallback='C:\Program Files\Google\Chrome\Application\chrome.exe'
  if(Test-Path $fallback){ $BrowserPath=$fallback } else { throw "Navigateur introuvable: $BrowserPath" }
}

$InstallDir='C:\ProgramData\CRVO\Guardian'
$TaskName="CRVO Guardian - $TargetKey"
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
$source=Join-Path $PSScriptRoot 'guardian.ps1'
if(-not (Test-Path $source)){ throw "guardian.ps1 est absent de $PSScriptRoot" }
Copy-Item $source (Join-Path $InstallDir 'guardian.ps1') -Force

$config=@{
  targetKey=$TargetKey
  token=$Token.ToLowerInvariant()
  screenUrl=$ScreenUrl
  supabaseUrl=$SupabaseUrl.TrimEnd('/')
  browserPath=$BrowserPath
  allowReboot=[bool]$AllowReboot
} | ConvertTo-Json -Depth 5
$configPath=Join-Path $InstallDir (($TargetKey -replace '\.','_') + '.json')
Set-Content -Path $configPath -Value $config -Encoding UTF8

& icacls $InstallDir /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' | Out-Null

$arguments="-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$InstallDir\guardian.ps1`" -ConfigPath `"$configPath`""
$action=New-ScheduledTaskAction -Execute 'PowerShell.exe' -Argument $arguments
$trigger=New-ScheduledTaskTrigger -AtStartup
$settings=New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
$principalTask=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principalTask -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host "Guardian installé et démarré: $TaskName" -ForegroundColor Green
Write-Host "Cible: $TargetKey"
Write-Host "Écran: $ScreenUrl"
Write-Host "Reboot distant autorisé: $([bool]$AllowReboot)"
Write-Host "La page Maintenance doit afficher un heartbeat sous environ 30 secondes."
