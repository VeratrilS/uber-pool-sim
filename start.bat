@echo off
rem PoolSim - opens the simulator in your default browser.
rem No server, no install: the app runs entirely from index.html.
cd /d "%~dp0"
start "" "%~dp0index.html"
