@echo off
setlocal
set "INSTALLER=%TEMP%\install-crvo-presence-bridge.ps1"
echo CRVO - Installation du pont SQL Presenteisme
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/Velvet-Application/CRVO/main/bridge/windows/presence/install-crvo-presence-bridge.ps1' -OutFile '%INSTALLER%'"
if errorlevel 1 goto :error
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%INSTALLER%"
if errorlevel 1 goto :error
echo.
echo Installation terminee. La synchronisation SQL CRVO est automatique toutes les 15 minutes.
pause
exit /b 0
:error
echo.
echo Une erreur a bloque l'installation. Copie l'ecran ou le message d'erreur et envoie-le dans le chat CRVO.
pause
exit /b 1
