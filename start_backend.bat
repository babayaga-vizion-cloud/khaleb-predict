@echo off
chcp 65001 >nul
if not exist .venv\Scripts\activate.bat (echo Lancez install_windows.bat d'abord & pause & exit /b 1)
call .venv\Scripts\activate.bat
uvicorn api:app --host 127.0.0.1 --port 8000
