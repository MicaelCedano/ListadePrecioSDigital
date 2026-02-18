@echo off
cd /d "%~dp0"
if exist ".venv\Scripts\pythonw.exe" (
    start "" ".venv\Scripts\pythonw.exe" "listadeprecios.py"
) else (
    echo Error: No se encontro la carpeta .venv. Asegurese de que esta instalada.
    pause
)
