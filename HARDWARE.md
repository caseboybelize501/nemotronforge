# 🖥️ Nemotron Hardware Specifications

## System Overview

This document defines the hardware environment for Nemotron AI code generation.
The AI model uses this information to optimize generated code for the target hardware.

---

## Hardware Stack

| Component | Specification |
|-----------|---------------|
| **CPU** | AMD Ryzen 9 7950X (16C/32T, 4.5GHz base, 5.7GHz boost) |
| **GPU** | NVIDIA GeForce RTX 5090 (32GB GDDR7 VRAM) |
| **RAM** | 128GB DDR5-5600 (4×32GB, dual-channel) |
| **Storage** | 4× Samsung NVMe SSDs |
| | - 2× 990 PRO 4TB (PCIe 5.0, ~14 GB/s read) |
| | - 2× 9100 PRO 4TB (PCIe 5.0, ~14 GB/s read) |
| **Total Storage** | 16TB NVMe RAID-capable |
| **Platform** | AM5 Socket, DDR5-only |

---

## AI Model Configuration

### Current Model

| Property | Value |
|----------|-------|
| **Model** | `qwen3.5:35b-a3b` |
| **Size** | 23GB (quantized GGUF) |
| **Context** | 32K tokens |
| **VRAM Usage** | ~23GB (fits in RTX 5090 32GB) |
| **RAM Usage** | ~35GB (system memory for KV cache) |

### Recommended Models for This Hardware

| Model | Size | Use Case |
|-------|------|----------|
| `qwen3.5:35b-a3b` | 23GB | **Primary** - Best code quality |
| `qwen2.5-coder:32b` | 20GB | Alternative coding model |
| `llama3.1:70b` | 40GB | Complex reasoning (requires RAM offload) |
| `codellama:34b` | 20GB | Legacy code support |
| `mistral-large:123b` | 70GB | Maximum quality (heavy RAM offload) |

### Ollama Configuration

Create `~/.ollama/config.json`:
```json
{
  "num_gpu": 99,
  "num_thread": 16,
  "num_ctx": 32768,
  "num_batch": 512,
  "main_gpu": 0,
  "low_vram": false
}
```

---

## Performance Characteristics

### CPU Capabilities

- **Parallel Compilation:** Up to 32 concurrent tasks
- **Rust Builds:** `cargo build --release` ~2-3 min for medium projects
- **TypeScript:** `tsc` full check ~10-15s for 100k LOC

### GPU Capabilities

- **CUDA Cores:** RTX 5090 (next-gen Ada/Blackwell)
- **Tensor Cores:** 4th gen (FP8/FP16 accelerated)
- **Inference Speed:** ~50-80 tok/s for 35B model (GPU-only)
- **VRAM Headroom:** 9GB free after 35B model load

### Memory Capabilities

- **Total:** 128GB DDR5-5600
- **Available for AI:** ~90GB (after OS + GUI)
- **Max Model Size:** Up to 120B with RAM offload
- **KV Cache:** ~10GB for 32K context at 35B

### Storage Capabilities

- **Project I/O:** ~14 GB/s sequential
- **Random Read:** ~1M IOPS
- **Git Operations:** Near-instant for typical repos
- **Model Loading:** 23GB in ~2 seconds

---

## Optimization Guidelines for AI

### Code Generation

1. **Parallelize builds** - Use all 16 cores
   ```toml
   # Cargo.toml
   [profile.release]
   lto = "thin"
   codegen-units = 16
   ```

2. **Large context windows** - 128GB RAM supports full-project analysis

3. **GPU-accelerated inference** - Keep models under 32GB for full GPU load

4. **Fast iteration** - NVMe speed enables instant file writes + git commits

### Recommended Patterns

```rust
// Rust: Use parallel compilation
// cargo build --jobs 16

// TypeScript: Use incremental builds
// tsc --watch --preserveWatchOutput

// Python: Use multiprocessing
// from multiprocessing import Pool
```

---

## Environment Variables

```bash
# Set in .env file
NEMOTRON_OUTPUT_DIR=D:\Users\CASE\Projects
OLLAMA_HOST=http://localhost:11434
OLLAMA_NUM_GPU=99
OLLAMA_NUM_THREAD=16

# GitHub
GITHUB_TOKEN=ghp_...
```

---

## Thermal Considerations

| Component | TDP | Cooling Recommendation |
|-----------|-----|------------------------|
| Ryzen 9 7950X | 170W | 360mm AIO or high-end air |
| RTX 5090 | 450W+ | Triple-slot, 3×12VHPWR |
| Total System | ~750W | 1000W+ PSU recommended |

**Sustained AI Inference:** Monitor GPU temps during long generation sessions.
RTX 5090 thermal throttling begins at 85°C.

---

## Future Upgrades

| Upgrade Path | Benefit |
|--------------|---------|
| 192GB RAM (6×32GB) | Run 70B+ models fully in RAM |
| 2× RTX 5090 | Dual-GPU inference for 100B+ models |
| PCIe 5.0 RAID 0 | 28 GB/s storage for massive project I/O |

---

## Hardware Detection

Nemotron automatically detects this hardware configuration via:
- `lscpu` / `wmic cpu` for CPU info
- `nvidia-smi` for GPU info  
- `free -h` / Windows API for RAM
- `lsblk` / WMI for storage

Generated code is optimized for:
- **x86_64** architecture
- **AVX-512** instructions (Ryzen 7000)
- **CUDA** compute capability 9.x+ (RTX 5090)
