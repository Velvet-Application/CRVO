@echo off
setlocal
set "INSTALLER=%TEMP%\install-crvo-presence-bridge-v3.ps1"
echo CRVO - Installation du pont SQL Presenteisme
echo.
echo Detection des connexions Excel, QueryTable et fichiers ODC.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/Velvet-Application/CRVO/main/bridge/windows/presence/install-crvo-presence-bridge.ps1?ts=202608141115' -OutFile '%INSTALLER%'"
if errorlevel 1 goto :error
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%INSTALLER%"
if errorlevel 1 goto :error
echo.
echo Installation terminee. Synchronisation SQL CRVO automatique toutes les 15 minutes.
pause
exit /b 0
:error
echo.
echo Une erreur a bloque l'installation. Copie le message d'erreur et envoie-le dans le chat CRVO.
pause
exit /b 1
