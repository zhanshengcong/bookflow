@echo off
setlocal enabledelayedexpansion
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "HEALTHCHECK=%ROOT%\scripts\healthcheck.js"
echo ROOT=[%ROOT%]
echo HEALTHCHECK=[%HEALTHCHECK%]
if exist "%HEALTHCHECK%" (echo FILE EXISTS) else (echo FILE MISSING)
