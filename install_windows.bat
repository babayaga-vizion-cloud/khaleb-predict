@echo off
chcp 65001 >nul
where py >nul 2>nul || (echo Installez Python 3.11/3.12 depuis python.org avec Add Python to PATH & pause & exit /b 1)
py -3 -m venv .venv
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt
if errorlevel 1 (echo Installation en erreur. Verifiez Python et Internet. & pause & exit /b 1)
if not exist models mkdir models
echo Installation terminee. Lancez start_backend.bat
pause
