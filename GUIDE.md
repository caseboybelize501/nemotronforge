# Nemotron Guide

## Two Core Principles

### 1. 🚀 Automatic GitHub Push on Every Build

**Nemotron automatically creates a GitHub repository and pushes all generated code.**

Every time you generate a project:
1. Files are written to your local output directory
2. A git repository is initialized with an initial commit
3. A new **private** repository is created on GitHub via API
4. All code is pushed to `main` branch

#### How It Works

```
User Input → AI Model → Generate Files → Git Init → GitHub Create Repo → Push
```

#### Requirements

- **GitHub Personal Access Token (PAT)** stored in `.env` file
- Token scopes: `repo` (full control of private repositories)
- Free tier GitHub account works perfectly (unlimited public/private repos)

#### Security

- Token is loaded from `.env` file (never committed to git)
- Uses HTTPS authentication with Bearer token
- No billing required - GitHub free tier includes unlimited private repos

#### Create Your Token

1. Go to: https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Select scope: `repo` ✓
4. Copy the token
5. Paste into `.env` file:
   ```
   GITHUB_TOKEN=ghp_your_token_here
   ```

---

### 2. 🧠 Working AI Model Integration

**The GUI model actually generates code - with real-time streaming output.**

#### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Tauri GUI (React + TypeScript)                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐    │
│  │ Model       │  │ JSON        │  │ Real-time       │    │
│  │ Scanner     │  │ Generator   │  │ Token Streaming │    │
│  └─────────────┘  └─────────────┘  └─────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                          ↓ invokes
┌─────────────────────────────────────────────────────────────┐
│  Rust Backend (src-tauri/src/main.rs)                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐    │
│  │ Ollama API  │  │ Git2        │  │ GitHub REST     │    │
│  │ Client      │  │ Library     │  │ API Client      │    │
│  └─────────────┘  └─────────────┘  └─────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                          ↓ connects to
┌─────────────────────────────────────────────────────────────┐
│  Local Services                                            │
│  ┌─────────────┐  ┌─────────────┐                          │
│  │ Ollama      │  │ GitHub      │                          │
│  │ (localhost) │  │ API         │                          │
│  └─────────────┘  └─────────────┘                          │
└─────────────────────────────────────────────────────────────┘
```

#### Model Requirements

- **Ollama** must be installed and running
- Recommended: `qwen3.5:35b-a3b` or `qwen2.5-coder:32b`
- Minimum 16GB RAM for 7B models, 64GB+ for 35B+ models

#### Install Ollama

```powershell
winget install Ollama.Ollama
```

#### Pull a Model

```powershell
ollama pull qwen3.5:35b-a3b
```

#### JSON Strict Mode

For complex prompts (like the FPGA Jarvis framework), enable **JSON Strict Mode**:
- Appends strict JSON instructions to system prompt
- Model outputs ONLY valid JSON arrays
- No markdown, no explanations, no text before/after

Example system prompt addition:
```
STRICT JSON MODE: Output ONLY the JSON array. No text before or after.
Format: { "files": [{ "path": "string", "content": "string", "language": "string" }] }
```

---

## Framework Architecture

The framework supports complex multi-file project generation:

### Agent Pattern (Extensible)

```
┌─────────────────────────────────────────────────────────────┐
│  Planner LLM                                                │
│  (Routes to specialized agents based on task)              │
└─────────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────────┐
│  Specialized Agents                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │ RTL      │ │ Sim      │ │ Synth    │ │ Learn    │      │
│  │ Agent    │ │ Agent    │ │ Agent    │ │ Agent    │      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
└─────────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────────┐
│  Tools + Memory                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐    │
│  │ CLI Tools   │  │ RAG Memory  │  │ Graph Database  │    │
│  │ (Vivado,   │  │ (ChromaDB)  │  │ (Neo4j)         │    │
│  │ Yosys)     │  │             │  │                 │    │
│  └─────────────┘  └─────────────┘  └─────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### 10-Stage Validation Cycle

For hardware/FPGA projects, the framework supports:

1. **Lint** - Zero warnings
2. **Behavioral Sim** - All assertions pass
3. **Code Coverage** - ≥90% toggle + branch
4. **Synthesis** - No critical errors
5. **Timing (Setup)** - WNS ≥ 0
6. **Timing (Hold)** - WHS ≥ 0
7. **Resource Fit** - ≤80% utilization
8. **Power Estimate** - Within budget
9. **Hardware Test** - IO validation on FPGA
10. **Regression** - Prior designs still pass

**STABLE Gate:** 7 consecutive passing cycles required.

---

## Quick Start

### 1. Install Dependencies

```powershell
# Rust
winget install Rustlang.Rustup

# Ollama
winget install Ollama.Ollama

# Node.js (if not installed)
winget install OpenJS.NodeJS.LTS
```

### 2. Configure GitHub Token

Create `.env` file:
```
GITHUB_TOKEN=ghp_your_token_here
NEMOTRON_OUTPUT_DIR=D:\Users\CASE\Projects
```

### 3. Pull AI Model

```powershell
ollama pull qwen3.5:35b-a3b
```

### 4. Run Nemotron

```powershell
npm install
npm run tauri dev
```

---

## 🧪 Sandbox Testing (Core Workflow)

**Before generating your first project, run the built-in sandbox test to verify your environment is properly configured.**

### How to Run Sandbox Test

1. Open Nemotron
2. Click the **Models** tab
3. Scroll to **🧪 Sandbox Environment Test**
4. Click **Run Sandbox Test**
5. Review the test results

### What Gets Tested

```
┌─────────────────────────────────────────────────────────────┐
│  Sandbox Test Suite                                         │
├─────────────────────────────────────────────────────────────┤
│  ✅ Rust Toolchain      → rustc --version                   │
│  ✅ Cargo               → cargo --version                   │
│  ✅ Ollama              → ollama --version                  │
│  ✅ Node.js             → node --version                    │
│  ✅ npm                 → npm --version                     │
│  ✅ Tauri Compilation   → cargo check (dry run)             │
└─────────────────────────────────────────────────────────────┘
```

### Interpreting Results

**✅ All Tests Passed**
- Your environment is ready
- You can safely generate projects
- GitHub integration will work (if token configured)

**❌ Some Tests Failed**
- Review the error messages for each failed test
- Follow the recovery steps below
- Re-run the test after fixing issues

### Test Output Example

```
✅ Rust version check
   Output: rustc 1.85.0 (4d91de4e4 2025-02-17)

❌ Ollama version check
   Error: Failed to run ollama: The system cannot find the file specified.
   
   → Recovery: Install Ollama with `winget install Ollama.Ollama`
```

---

## 5. Generate a Project

1. Click **Builder** tab
2. Select **From Template** or **AI Freeform**
3. Enter project name and description
4. (Optional) Select skills/memory for context
5. Click **Generate Project**
6. Review generated files in preview
7. Click **Build & Push to GitHub**

---

## 🔧 Troubleshooting & Known Failure Modes

### ⚠️ Persistent Issues & Limitations

#### Tauri v2 Hot Reload Does Not Work for Rust Changes

**Problem:** After modifying `src-tauri/src/main.rs` or `Cargo.toml`, changes don't appear automatically.

**Cause:** Tauri v2 changed the dev server architecture. Rust code must be fully recompiled.

**Solution:**
1. Close the running app (Ctrl+C in terminal)
2. Run `.\dev.bat` to restart
3. Wait for full rebuild (~30-60 seconds)

**Frontend changes (React/TypeScript/CSS) DO hot reload automatically** - only Rust changes require restart.

---

#### "Scan for Models" Button Does Nothing / Shows "No models found"

**Problem:** Clicking the scan button doesn't detect Ollama models.

**Cause:** The Rust backend can't find the `ollama` command in PATH. This happens when:
- App is launched without proper PATH setup
- Ollama is installed in a non-standard location
- Terminal session doesn't have cargo/ollama in PATH

**Solution:**
1. **Always use `.\dev.bat` or `.\dev.ps1`** to launch the app
2. These scripts add cargo and ollama to PATH automatically
3. If still failing, verify ollama works in terminal:
   ```powershell
   ollama list
   ```
4. Restart the app using the launcher script

**DO NOT run `cargo tauri dev` directly** - it won't have the correct PATH.

---

### Environment Issues

#### "GitHub token not found"
**Symptom:** Build fails with token error
**Cause:** `.env` file missing or token not loaded

**Recovery:**
1. Create `.env` file in project root
2. Add: `GITHUB_TOKEN=ghp_your_token_here`
3. Restart the app
4. Verify token has `repo` scope

---

#### "Ollama command failed"
**Symptom:** Model scan returns empty or error
**Cause:** Ollama not installed or service not running

**Recovery:**
```powershell
# Install Ollama
winget install Ollama.Ollama

# Verify installation
ollama --version

# Pull a model
ollama pull qwen2.5-coder:32b

# Check running models
ollama list
```

---

#### "Model not found"
**Symptom:** Qwen location scan returns `found: false`
**Cause:** No qwen model installed in Ollama

**Recovery:**
```powershell
# List available models
ollama list

# Install qwen model
ollama pull qwen3.5:35b-a3b
# OR (for lower RAM)
ollama pull qwen2.5-coder:7b
```

---

#### "Rust toolchain not found"
**Symptom:** Sandbox test fails on rustc/cargo checks
**Cause:** Rust not installed or not in PATH

**Recovery:**
```powershell
# Install Rust
winget install Rustlang.Rustup

# Restart terminal to load PATH
# Verify installation
rustc --version
cargo --version
```

---

### Build & Compilation Issues

#### Tauri build fails with "frontendDist not found"
**Symptom:** `error: The frontendDist configuration is set to "../dist" but this path doesn't exist`
**Cause:** Frontend not built before Tauri compilation

**Recovery:**
```powershell
# Build frontend first
npm run build

# Then run Tauri
npm run tauri dev
```

---

#### "Failed to create project directory"
**Symptom:** Build fails when writing files
**Cause:** Output directory doesn't exist or permission denied

**Recovery:**
1. Check `NEMOTRON_OUTPUT_DIR` in `.env`
2. Ensure directory exists: `mkdir D:\Users\CASE\Projects`
3. Verify write permissions
4. Try a different output path

---

#### "Failed to init git repo"
**Symptom:** Build fails after file generation
**Cause:** Git not installed or directory not empty

**Recovery:**
```powershell
# Install Git
winget install Git.Git

# Clear existing project directory
rm -rf "D:\Users\CASE\Projects\your-project-name"

# Retry build
```

---

#### "Failed to push to GitHub"
**Symptom:** Local build succeeds, push fails
**Cause:** Invalid token, network issue, or repo name conflict

**Recovery:**
1. Verify token is valid: https://github.com/settings/tokens
2. Check token has `repo` scope
3. Ensure repo name is unique (or delete existing repo)
4. Check network connectivity
5. Review GitHub API status: https://www.githubstatus.com/

---

### Runtime Issues

#### Event listener permission error
**Symptom:** `⚠️ event.listen not allowed`
**Cause:** Tauri v2 capabilities not configured

**Recovery:**
1. Ensure `src-tauri/capabilities/default.json` exists
2. Verify `core:event:allow-listen` permission is present
3. Kill running app: `taskkill /F /IM nemotron.exe`
4. Restart: `npm run tauri dev`

---

#### "Qwen not found" during generation
**Symptom:** Generate button fails with Qwen error
**Cause:** Model not detected or Ollama service stopped

**Recovery:**
1. Click **Models** tab first
2. Run **Scan System Models**
3. Verify qwen model appears in list
4. If using Ollama: `ollama list` should show qwen
5. Restart Ollama service if needed

---

#### JSON parsing fails
**Symptom:** Generated files don't appear, error in console
**Cause:** Model output malformed JSON

**Recovery:**
1. Enable **JSON Strict Mode** in settings
2. Use simpler prompts initially
3. Try a larger model (35B vs 7B)
4. Add explicit JSON format instructions to prompt

---

### Performance Issues

#### Model generation is very slow
**Symptom:** Tokens appear slowly or timeout
**Cause:** Model too large for available RAM

**Recovery:**
```powershell
# Use smaller model
ollama pull qwen2.5-coder:7b

# Or use quantized version
ollama pull qwen2.5-coder:32b-q4_K_M

# Monitor system resources
# Task Manager → Performance → Memory
```

---

#### High memory usage
**Symptom:** System becomes unresponsive during generation
**Cause:** Large model + Tauri dev tools

**Recovery:**
1. Close browser DevTools if open
2. Use smaller quantized models
3. Close other applications
4. Consider running Ollama on separate machine

---

### Getting Help

If issues persist:
1. Run **Sandbox Test** and screenshot results
2. Check console logs (F12 in dev mode)
3. Review `.env` configuration
4. Verify all dependencies with `npm run tauri dev -- --verbose`
