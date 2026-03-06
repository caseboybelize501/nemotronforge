@echo off
REM Nemotron Development Launcher (Batch)
REM This script sets up the environment and runs the Tauri dev server

echo ========================================
echo    Nemotron Development Launcher
echo ========================================
echo.

REM Check if cargo exists in PATH first
where cargo >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [INFO] Cargo not in PATH, adding user cargo bin...
    set "PATH=%PATH%;%USERPROFILE%\.cargo\bin"
)

echo [INFO] Checking cargo installation...
cargo --version
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Cargo not found!
    echo Please install Rust from: https://rustup.rs/
    echo.
    pause
    exit /b 1
)

echo.
echo [INFO] Cargo found: %USERPROFILE%\.cargo\bin
echo.

cd /d "%~dp0"

echo [INFO] Starting Nemotron development server...
echo.
echo [INFO] Press Ctrl+C to stop the server
echo.

cargo tauri dev
