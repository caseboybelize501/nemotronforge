# 🔄 Development Workflow & Known Limitations

## Hot Reload Behavior

### What Works Automatically ✅
- **React Component Changes** (`.tsx` files)
- **TypeScript Changes** (`.ts` files)
- **CSS/Styling Changes** (`.css` files)
- **HTML Changes** (`index.html`)

When you edit these files, the browser window refreshes automatically in < 1 second.

### What Requires App Restart ❌
- **Rust Backend Changes** (`src-tauri/src/main.rs`)
- **Cargo Dependencies** (`src-tauri/Cargo.toml`)
- **Tauri Configuration** (`src-tauri/tauri.conf.json`)
- **New Rust Files or Modules**

When you edit these files, you **MUST** restart the app.

---

## Why Rust Changes Don't Hot Reload

Tauri v2 (released 2024) changed the development server architecture:

1. **Tauri v1:** Had partial hot reload for some Rust changes
2. **Tauri v2:** Requires full recompilation for any Rust code change

This is because:
- Rust is a compiled language (not interpreted)
- Tauri commands (`#[tauri::command]`) are baked into the binary at compile time
- Type changes in Rust require full type-checking across the entire project

**Rebuild Time:** ~30-60 seconds on average hardware

---

## Correct Development Workflow

### Step 1: Launch the App Properly

**✅ CORRECT:**
```powershell
.\dev.bat
# OR
.\dev.ps1
```

**❌ WRONG:**
```powershell
cargo tauri dev
# This won't have PATH set correctly for ollama commands
```

### Step 2: Make Frontend Changes

Edit files in `src/`:
- Components update instantly
- No restart needed
- Browser refreshes automatically

### Step 3: Make Backend Changes

Edit files in `src-tauri/`:
1. Save your Rust code changes
2. **The app will NOT update automatically**
3. Close the running app (Ctrl+C in terminal)
4. Run `.\dev.bat` again
5. Wait for full rebuild

### Step 4: Test Changes

- Frontend: Immediate visual feedback
- Backend: Must restart app, then test functionality

---

## Common Problems & Solutions

### Problem: "Scan for Models" Does Nothing

**Symptoms:**
- Button clicks but nothing happens
- Shows "No models found" even though Ollama has models
- Console shows: `Failed to run ollama: The system cannot find the file specified`

**Root Cause:**
The Rust backend can't find `ollama.exe` because:
1. App was launched without `.\dev.bat`
2. PATH doesn't include Ollama's installation directory
3. Terminal session has different PATH than the Tauri app

**Solution:**
1. Close the app
2. **Always use `.\dev.bat`** to launch
3. The script adds ollama to PATH automatically

**Verification:**
```powershell
# In terminal BEFORE running app:
ollama list

# Should show your models:
# NAME              SIZE      MODIFIED
# qwen3.5:35b       23 GB     4 hours ago
```

---

### Problem: Changes Don't Appear After Editing main.rs

**Symptoms:**
- Edited `src-tauri/src/main.rs`
- Saved the file
- App looks exactly the same
- No errors, no updates

**Root Cause:**
Rust code must be recompiled. Tauri v2 doesn't auto-reload Rust changes.

**Solution:**
1. Press Ctrl+C in the terminal running the app
2. Run `.\dev.bat` again
3. Wait for compilation (watch for "Compiling nemotron" messages)
4. App launches with new code

**Tip:** Make all your Rust changes at once, then restart once (instead of restarting after each small change).

---

### Problem: GitHub Push Fails After Model Switch

**Symptoms:**
- Model switching works
- But GitHub push fails
- Or local git init doesn't happen

**Root Cause:**
This was a bug in earlier versions where model switching triggered a different workflow.

**Solution:**
- **Fixed!** The workflow is now unified in the Builder panel
- Model selection and project building are on the same page
- No separate "Models" tab that could cause workflow issues

---

## PATH Environment Variable Issues

### Why PATH Matters

The Rust backend needs to find these executables:
- `ollama.exe` - For AI model inference
- `cargo.exe` - For Rust compilation (dev only)
- `git.exe` - For version control

Windows PATH is inherited from the parent process. If you launch the app from a terminal that doesn't have these in PATH, the app won't find them either.

### How `dev.bat` Fixes This

```batch
@echo off
REM Check if cargo exists in PATH first
where cargo >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [INFO] Cargo not in PATH, adding user cargo bin...
    set "PATH=%PATH%;%USERPROFILE%\.cargo\bin"
)
```

The script:
1. Checks if cargo is available
2. If not, adds `%USERPROFILE%\.cargo\bin` to PATH
3. Then runs `cargo tauri dev` with the updated PATH
4. Ollama is found because it's in the system PATH (installed globally)

---

## Best Practices

### 1. Use the Launcher Script Always
```powershell
# Make it a habit
.\dev.bat
```

### 2. Batch Your Rust Changes
Instead of:
- Edit Rust → Restart → Test → Edit Rust → Restart → Test

Do:
- Edit Rust (multiple files/functions) → Restart Once → Test Everything

### 3. Use Frontend for Rapid Prototyping
- Prototype UI logic in React/TypeScript (instant feedback)
- Add Rust backend commands last (requires restart)

### 4. Keep Terminal Open
- Keep a terminal open with `.\dev.bat` running
- When you need to restart, Ctrl+C and press ↑ (up arrow) to re-run

### 5. Check Console for Errors
- Press F12 in the app window to open DevTools
- Check Console tab for JavaScript errors
- Check terminal for Rust compilation errors

---

## Quick Reference

| Task | Command | Hot Reload? |
|------|---------|-------------|
| Launch app | `.\dev.bat` | N/A |
| Stop app | Ctrl+C | N/A |
| Edit React component | Edit `.tsx` | ✅ Instant |
| Edit TypeScript | Edit `.ts` | ✅ Instant |
| Edit CSS | Edit `.css` | ✅ Instant |
| Edit Rust command | Edit `main.rs` | ❌ Restart required |
| Add Rust dependency | Edit `Cargo.toml` | ❌ Restart required |
| Test ollama | `ollama list` | N/A |
| Test cargo | `cargo --version` | N/A |

---

## Reporting Issues

When reporting bugs, always include:

1. **How you launched the app:**
   - `.\dev.bat` ✅
   - `cargo tauri dev` ❌

2. **What you changed:**
   - Frontend files? (should hot reload)
   - Backend files? (requires restart)

3. **Error messages:**
   - Terminal output
   - Browser console (F12)
   - Screenshot of the error

4. **Ollama status:**
   - Run `ollama list` and share output
   - Confirm ollama works in terminal

---

**Last Updated:** 2025-03-06  
**Tauri Version:** 2.x  
**Known Issue:** Rust hot reload not supported (by design in Tauri v2)
