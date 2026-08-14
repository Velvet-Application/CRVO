@echo off
chcp 65001 >nul
setlocal
set "INSTALLER=%TEMP%\install-crvo-presence-bridge-v2.ps1"
echo CRVO - Installation du pont SQL Présentéisme
echo.
echo Cette version détecte les connexions Excel classiques, QueryTable et fichiers .ODC.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/Velvet-Application/CRVO/main/bridge/windows/presence/install-crvo-presence-bridge.ps1?ts=202608141105' -OutFile '%INSTALLER%'"
if errorlevel 1 goto :error
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%INSTALLER%"
if errorlevel 1 goto :error
echo.
echo Installation terminée. La synchronisation SQL CRVO est automatique toutes les 15 minutes.
pause
exit /b 0
:error
echo.
echo Une erreur a bloqué l'installation. Copie l'écran ou le message d'erreur et envoie-le dans le chat CRVO.
pause
exit /b 1
