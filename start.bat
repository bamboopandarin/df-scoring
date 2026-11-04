@echo off
cd /d "%~dp0"
title DF Scoring
node --env-file-if-exists=.dev.vars tools/local-server.mjs
pause
