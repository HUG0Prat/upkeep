@echo off
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\UpKeep.exe" "%~dp0app.asar\dist-electron\cli.js" %*
exit /b %ERRORLEVEL%
