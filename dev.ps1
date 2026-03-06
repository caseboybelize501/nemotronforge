# Nemotron Development Launcher (PowerShell)
# This script sets up the environment and runs the Tauri dev server

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   Nemotron Development Launcher" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Add cargo to PATH
$cargoPath = "$env:USERPROFILE\.cargo\bin"
if ($env:Path -notlike "*$cargoPath*") {
    Write-Host "[INFO] Adding cargo to PATH..." -ForegroundColor Yellow
    $env:Path += ";$cargoPath"
}

# Verify cargo is available
Write-Host "[INFO] Checking cargo installation..." -ForegroundColor Cyan
$cargoVersion = cargo --version 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[ERROR] Cargo not found!" -ForegroundColor Red
    Write-Host "Please install Rust from: https://rustup.rs/" -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "[INFO] Cargo found: $cargoVersion" -ForegroundColor Green
Write-Host ""

# Navigate to project
Set-Location $PSScriptRoot

# Run Tauri dev
Write-Host "[INFO] Starting Nemotron development server..." -ForegroundColor Green
Write-Host "[INFO] Press Ctrl+C to stop the server" -ForegroundColor Gray
Write-Host ""

cargo tauri dev
