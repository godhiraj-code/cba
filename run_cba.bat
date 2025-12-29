@echo off
setlocal
echo 🌠 Starlight Protocol: CBA Orchestration Launcher
echo --------------------------------------------------
:: NOTE: Ensure Ollama is running 'moondream' for the Vision Sentinel.

:: 1. Force kill any previous Hub process on port 8080
echo [Launcher] Cleaning environment (Port 8080)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8080') do (
    if NOT "%%a"=="" taskkill /f /pid %%a >nul 2>&1
)

:: 2. Launch the Hub (Node.js)
echo [Launcher] Launching CBA Hub...
start "CBA Hub" cmd /c "node src/hub.js"
timeout /t 3 /nobreak >nul

:: 2.5 Launch the Pulse Sentinel (Python - Stability Monitor)
echo [Launcher] Launching Pulse Sentinel...
start "CBA Pulse" cmd /c "python sentinels/pulse_sentinel.py"
timeout /t 2 /nobreak >nul

:: 3. Launch the Janitor Sentinel (Python)
echo [Launcher] Launching Janitor Sentinel...
start "CBA Janitor" cmd /c "python sentinels/janitor.py"
timeout /t 2 /nobreak >nul

:: 4. Launch the Vision Sentinel (Python - AI Mode)
echo [Launcher] Launching Vision Sentinel (Ollama/moondream)...
start "CBA Vision" cmd /c "python sentinels/vision_sentinel.py"
timeout /t 5 /nobreak >nul

:: 4.5 Launch the Data Sentinel (Python - Context Injection)
echo [Launcher] Launching Data Sentinel...
start "CBA Data" cmd /c "python sentinels/data_sentinel.py"
timeout /t 2 /nobreak >nul

:: 5. Launch the Intent Layer (The Mission)
echo [Launcher] Executing Mission Intent...
node src/intent.js

echo --------------------------------------------------
echo [Launcher] Mission Complete. Check Hub window for Hero Story generation.
pause
