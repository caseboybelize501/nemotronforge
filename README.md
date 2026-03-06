# 🔨 Nemotron

**AI-Powered Software Fabrication Engine**

A Tauri v2 desktop application that generates complete, production-ready software projects using local AI models. Automatically creates GitHub repositories and pushes all generated code.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Tauri](https://img.shields.io/badge/Tauri-v2.0-red)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)
![Rust](https://img.shields.io/badge/Rust-1.85-orange)

---

## 🎯 What is Nemotron?

Nemotron is a **software fabrication engine** that combines:
- 🧠 **Local AI Models** (Ollama, LM Studio) for code generation
- 📦 **Tauri v2 Desktop App** for a modern GUI
- 🚀 **Automatic GitHub Integration** for instant repository creation
- 🔒 **Privacy-First** - runs entirely on your machine

Perfect for:
- Rapid prototyping
- Boilerplate generation
- Learning new frameworks
- Automating repetitive project setup

---

## ✨ Features

### Core Features
- **AI Model Scanner** - Automatically detects Ollama and LM Studio models
- **Real-time Token Streaming** - Watch AI generate code live
- **JSON Strict Mode** - Enforces valid JSON output for complex projects
- **Automatic GitHub Push** - Every build creates a private GitHub repo
- **Multi-File Generation** - Generates complete project structures
- **Skill/Memory System** - Contextual AI responses based on past projects

### Advanced Features
- **Sandbox Environment Testing** - Verify your setup before generating
- **Model Quality Scoring** - Recommends best models for coding tasks
- **Token Count Estimation** - Prevents context window overflow
- **Template System** - Pre-built project templates
- **Freeform Mode** - Describe anything, get complete projects

---

## 🚀 Quick Start

### Prerequisites

| Tool | Version | Install Command |
|------|---------|-----------------|
| Rust | 1.85+ | `winget install Rustlang.Rustup` |
| Node.js | 18+ | `winget install OpenJS.NodeJS.LTS` |
| Ollama | Latest | `winget install Ollama.Ollama` |
| Git | Latest | `winget install Git.Git` |

### Installation

```powershell
# Clone repository
git clone https://github.com/your-username/nemotronforge.git
cd nemotronforge

# Install dependencies
npm install

# Configure environment
echo "GITHUB_TOKEN=ghp_your_token_here" > .env
echo "NEMOTRON_OUTPUT_DIR=D:\Users\CASE\Projects" >> .env

# Pull AI model (choose based on your RAM)
ollama pull qwen2.5-coder:7b      # 7B model (16GB RAM)
ollama pull qwen3.5:35b-a3b       # 35B model (64GB+ RAM)

# Run development server (USE THE LAUNCHER SCRIPT)
.\dev.bat       # Windows batch
# OR
.\dev.ps1       # PowerShell
```

### ⚠️ Important: Hot Reload Limitation

**Tauri v2 does NOT support automatic hot reload for Rust backend changes.**

| Change Type | Hot Reload? | What to Do |
|-------------|-------------|------------|
| **Frontend (React/TS/CSS)** | ✅ Yes | Saves automatically refresh |
| **Rust Backend (main.rs)** | ❌ No | **Must restart the app** |
| **Cargo.toml dependencies** | ❌ No | **Must restart the app** |

**To restart after Rust changes:**
1. Close the running app (Ctrl+C in terminal)
2. Run `.\dev.bat` again
3. Wait for full rebuild (~30-60 seconds)

**Why?** Tauri v2 changed how the dev server works. Rust code must be recompiled and the app restarted.

### ✅ Working Launcher

**Always use `.\dev.bat` or `.\dev.ps1`** - These scripts:
- Add cargo to PATH automatically
- Verify cargo installation
- Start the dev server with correct environment
- Ensure ollama commands work from the Rust backend

**DO NOT run `cargo tauri dev` directly** unless you've manually set up PATH.

### First Project

1. **Run Sandbox Test** (Models tab) - Verify environment ✅
2. **Select AI Model** - Choose from detected models
3. **Enter Prompt** - Describe your project
4. **Generate** - Watch AI create files in real-time
5. **Build & Push** - Automatically creates GitHub repo

---

## 🧪 Sandbox Testing

**Always run the sandbox test before your first project!**

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

### How to Run
1. Open Nemotron
2. Click **Models** tab
3. Scroll to **🧪 Sandbox Environment Test**
4. Click **Run Sandbox Test**
5. Review results - all tests should pass ✅

---

## 📖 Documentation

| Document | Description |
|----------|-------------|
| [GUIDE.md](./GUIDE.md) | Complete user guide with troubleshooting |
| [HARDWARE.md](./HARDWARE.md) | Hardware requirements and model recommendations |
| [LICENSE](./LICENSE) | MIT License |

---

## 🏗️ Architecture

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

---

## 🔧 Known Failure Modes & Recoveries

### Common Issues

| Symptom | Cause | Recovery |
|---------|-------|----------|
| `GitHub token not found` | `.env` missing | Create `.env` with `GITHUB_TOKEN=ghp_...` |
| `Ollama command failed` | Ollama not installed | `winget install Ollama.Ollama` |
| `Model not found` | No qwen model | `ollama pull qwen2.5-coder:7b` |
| `frontendDist not found` | Frontend not built | `npm run build` then retry |
| `event.listen not allowed` | Missing capabilities | Check `src-tauri/capabilities/default.json` |
| `Failed to push to GitHub` | Invalid token | Regenerate token with `repo` scope |

### Detailed Troubleshooting

See [GUIDE.md - Troubleshooting Section](./GUIDE.md#troubleshooting--known-failure-modes) for comprehensive recovery steps.

---

## 🛠️ Development

### Project Structure
```
nemotronforge/
├── src/                    # React frontend
│   ├── components/         # UI components
│   ├── hooks/              # Custom hooks
│   ├── lib/                # Utilities
│   └── types/              # TypeScript types
├── src-tauri/              # Rust backend
│   ├── src/
│   │   └── main.rs         # Tauri commands
│   ├── capabilities/       # Tauri v2 permissions
│   └── tauri.conf.json     # Tauri configuration
├── .env                    # Environment variables (gitignored)
├── GUIDE.md                # User guide
└── README.md               # This file
```

### Build Commands

```powershell
# Development mode
npm run tauri dev

# Production build
npm run tauri build

# Build frontend only
npm run build

# Check Rust code
cd src-tauri
cargo check

# Run Rust tests
cargo test
```

---

## 📦 Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 18, TypeScript, Vite 7 |
| **Desktop** | Tauri v2, Rust |
| **AI Runtime** | Ollama, LM Studio |
| **Version Control** | Git2 (Rust), GitHub API |
| **Styling** | Custom CSS with CSS variables |

---

## 🔒 Security

- **Local-First**: All AI inference runs on your machine
- **Token Storage**: GitHub token stored in `.env` (gitignored)
- **No Telemetry**: No data sent to external services except GitHub API
- **Open Source**: All code is auditable

---

## 📄 License

MIT License - see [LICENSE](./LICENSE) for details.

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

---

## 🙏 Acknowledgments

- [Tauri](https://tauri.app/) - Desktop framework
- [Ollama](https://ollama.ai/) - Local AI runtime
- [Qwen](https://qwen.ai/) - AI model family
- [git2](https://github.com/rust-lang/git2-rs) - Rust git bindings

---

## 📬 Support

- **Documentation**: [GUIDE.md](./GUIDE.md)
- **Issues**: GitHub Issues
- **Discussions**: GitHub Discussions

---

**Built with ❤️ using Nemotron**
