// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::process::Command;
use tokio::sync::mpsc;
use std::fs;
use std::path::PathBuf;
use git2::{Repository, RepositoryInitOptions, Signature, IndexAddOption};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, USER_AGENT};
use tauri::Emitter;

// Backend configuration
const LLAMA_CPP_SERVER_URL: &str = "http://localhost:8080";

// Hardcoded model - llama.cpp format
const HARD_CODED_MODEL: &str = "qwen3-coder-30b.gguf";
const MODEL_PATH: &str = "D:\\Users\\CASE\\models\\qwen3-coder-30b.gguf";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    pub path: String,
    pub name: String,
    pub size_category: String,
    pub params: ModelParams,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelParams {
    pub ngl: u32,
    pub threads: u32,
    pub batch_size: u32,
    pub ubatch_size: u32,
    pub ctx_size: u32,
    pub cache_type_k: String,
    pub cache_type_v: String,
    pub flash_attn: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfigFile {
    pub models: Vec<ModelConfig>,
    pub default_model: String,
    pub size_category_defaults: std::collections::HashMap<String, ModelParams>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelLocation {
    pub found: bool,
    pub method: String,
    pub path: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub path: String,
    pub filename: String,
    pub size_bytes: u64,
    pub size_human: String,
    pub model_type: String,
    pub estimated_params: String,
    pub quality_score: f64,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    pub total_models: usize,
    pub total_size_bytes: u64,
    pub total_size_human: String,
    pub models: Vec<ModelInfo>,
    pub recommended_for_coding: Option<String>,
    pub recommended_for_chat: Option<String>,
    pub scan_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenCount {
    pub count: usize,
    pub max_allowed: usize,
    pub remaining: usize,
    pub is_safe: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedFile {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuildResult {
    pub success: bool,
    pub local_path: String,
    pub repo_url: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemMetrics {
    pub gpu_utilization: f32,
    pub vram_used_gb: f32,
    pub vram_total_gb: f32,
    pub cpu_utilization: f32,
    pub ram_used_gb: f32,
    pub ram_total_gb: f32,
    pub kv_cache_size_mb: f32,
    pub model_name: String,
    pub inference_active: bool,
}

#[tauri::command]
async fn get_system_metrics() -> Result<SystemMetrics, String> {
    use sysinfo::System;
    let mut sys = System::new();
    sys.refresh_cpu_usage();
    std::thread::sleep(std::time::Duration::from_millis(150));
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    let (_p, _t, _c, _m, u, _name, _fan, _limit, _f, used, total) = get_nvidia_smi_metrics();

    // Query llama.cpp server for actual GPU layers and KV cache
    let (_gpu_layers_current, _gpu_layers_total, kv_cache_used_mb) =
        query_llama_server_stats().await;

    Ok(SystemMetrics {
        gpu_utilization: u,
        vram_used_gb: used,
        vram_total_gb: total,
        cpu_utilization: sys.global_cpu_usage(),
        ram_used_gb: sys.used_memory() as f32 / (1024.0 * 1024.0 * 1024.0),
        ram_total_gb: sys.total_memory() as f32 / (1024.0 * 1024.0 * 1024.0),
        kv_cache_size_mb: kv_cache_used_mb,
        model_name: HARD_CODED_MODEL.to_string(),
        inference_active: u > 1.0,
    })
}

fn get_nvidia_smi_metrics() -> (f32, f32, f32, f32, f32, String, f32, f32, f32, f32, f32) {
    let output = Command::new("nvidia-smi")
        .args(&["--query-gpu=power.draw,temperature.gpu,clocks.gr,clocks.mem,utilization.gpu,name,fan.speed,power.max_limit,memory.free,memory.used,memory.total", "--format=csv,noheader,nounits"])
        .output();
    if let Ok(out) = output {
        if out.status.success() {
            let line = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let p: Vec<&str> = line.split(',').collect();
            if p.len() >= 11 {
                return (
                    p[0].trim().parse().unwrap_or(0.0),
                    p[1].trim().parse().unwrap_or(0.0),
                    p[2].trim().parse().unwrap_or(0.0),
                    p[3].trim().parse().unwrap_or(0.0),
                    p[4].trim().parse().unwrap_or(0.0),
                    p[5].trim().to_string(),
                    p[6].trim().parse().unwrap_or(0.0),
                    1300.0,
                    p[8].trim().parse::<f32>().unwrap_or(0.0) / 1024.0,
                    p[9].trim().parse::<f32>().unwrap_or(0.0) / 1024.0,
                    p[10].trim().parse::<f32>().unwrap_or(0.0) / 1024.0,
                );
            }
        }
    }
    (0.0, 0.0, 0.0, 0.0, 0.0, String::new(), 0.0, 1300.0, 0.0, 0.0, 0.0)
}

async fn query_llama_server_stats() -> (u32, u32, f32) {
    let client = reqwest::Client::new();
    let url = "http://localhost:8080/stats";

    match client.get(url).timeout(std::time::Duration::from_millis(500)).send().await {
        Ok(resp) => {
            if resp.status().is_success() {
                if let Ok(json) = resp.json::<serde_json::Value>().await {
                    let gpu_layers = json["gpu_layers"].as_u64().unwrap_or(0) as u32;
                    let kv_cache = json["kv_cache_used_mb"].as_f64().unwrap_or(0.0) as f32;
                    if gpu_layers == 0 {
                        return query_llama_server_props(&client).await;
                    }
                    return (gpu_layers, gpu_layers, kv_cache);
                }
            }
        }
        Err(_) => {}
    }
    query_llama_server_props(&client).await
}

async fn query_llama_server_props(client: &reqwest::Client) -> (u32, u32, f32) {
    let url = "http://localhost:8080/props";

    match client.get(url).timeout(std::time::Duration::from_millis(500)).send().await {
        Ok(resp) => {
            if resp.status().is_success() {
                if let Ok(json) = resp.json::<serde_json::Value>().await {
                    if let Some(model_info) = json.get("model") {
                        if let Some(layers) = model_info["n_gpu_layers"].as_u64() {
                            let ctx_size = model_info["n_ctx"].as_u64().unwrap_or(65536);
                            let kv_cache_mb = (layers as f32 * ctx_size as f32 * 2.0) / (1024.0 * 1024.0);
                            return (layers as u32, layers as u32, kv_cache_mb);
                        }
                    }
                }
            }
        }
        Err(_) => {}
    }
    (99, 99, 0.0)
}

#[tauri::command]
async fn locate_model() -> Result<ModelLocation, String> {
    // Check llama.cpp server first
    let client = reqwest::Client::new();
    match client.get(format!("{}/health", LLAMA_CPP_SERVER_URL)).send().await {
        Ok(resp) if resp.status().is_success() => {
            return Ok(ModelLocation {
                found: true,
                method: "llama.cpp".to_string(),
                path: Some(MODEL_PATH.to_string()),
                model: Some(HARD_CODED_MODEL.to_string()),
            });
        }
        _ => {}
    }

    // Check if model file exists
    if std::path::Path::new(MODEL_PATH).exists() {
        return Ok(ModelLocation {
            found: true,
            method: "llama.cpp".to_string(),
            path: Some(MODEL_PATH.to_string()),
            model: Some(HARD_CODED_MODEL.to_string()),
        });
    }

    // Check alternative model directories
    let model_dirs = vec![
        "D:\\models",
        "D:\\AI\\models",
        "C:\\models",
    ];

    for dir in model_dirs {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                    if ext.eq_ignore_ascii_case("gguf") {
                        return Ok(ModelLocation {
                            found: true,
                            method: "llama.cpp".to_string(),
                            path: Some(path.to_string_lossy().to_string()),
                            model: Some(path.file_name().unwrap().to_string_lossy().to_string()),
                        });
                    }
                }
            }
        }
    }

    Ok(ModelLocation {
        found: false,
        method: "none".to_string(),
        path: None,
        model: None,
    })
}

#[tauri::command]
async fn start_llama_server(model_path: Option<String>) -> Result<String, String> {
    use std::process::{Command, Stdio};

    // Check if already running
    if check_llama_server_status().await?.running {
        return Ok("Server is already running".to_string());
    }

    // Find llama-server.exe
    let server_exe = PathBuf::from("llama-cpp\\llama-server.exe");
    if !server_exe.exists() {
        return Err("llama-server.exe not found. Please install llama.cpp.".to_string());
    }

    // Find a model if not provided
    let model = model_path.or_else(|| find_gguf_model());

    if model.is_none() {
        return Err("No GGUF model found. Please download a model or provide a path.".to_string());
    }

    let model_path = model.unwrap();

    // Load model-specific config from model-config.json
    let config = load_model_config(&model_path);

    // Start the server process (detached, won't block app)
    let mut cmd = Command::new(&server_exe);
    cmd.arg("-m").arg(&model_path)
        .arg("--host").arg("127.0.0.1")
        .arg("--port").arg("8080")
        .arg("-c").arg(config.ctx_size.to_string())
        .arg("-ngl").arg(config.ngl.to_string())
        .arg("--threads").arg(config.threads.to_string())
        .arg("--batch-size").arg(config.batch_size.to_string())
        .arg("--ubatch-size").arg(config.ubatch_size.to_string());

    if config.flash_attn {
        cmd.arg("-fa").arg("on");
    }

    cmd.arg("--cache-type-k").arg(&config.cache_type_k)
        .arg("--cache-type-v").arg(&config.cache_type_v)
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let _child = cmd.spawn()
        .map_err(|e| format!("Failed to start server: {}", e))?;

    // Wait a moment for server to start
    std::thread::sleep(std::time::Duration::from_secs(3));

    Ok(format!("Starting llama.cpp server with model: {}", model_path))
}

fn load_model_config(model_path: &str) -> ModelParams {
    // Default params
    let default_params = ModelParams {
        ngl: 99,
        threads: 16,
        batch_size: 4096,
        ubatch_size: 1024,
        ctx_size: 32768,
        cache_type_k: "f16".to_string(),
        cache_type_v: "f16".to_string(),
        flash_attn: true,
    };

    // Try to load config file
    let config_path = PathBuf::from("model-config.json");
    if !config_path.exists() {
        return default_params;
    }

    // Read and parse config
    match fs::read_to_string(&config_path) {
        Ok(content) => {
            match serde_json::from_str::<ModelConfigFile>(&content) {
                Ok(config_file) => {
                    // Look for exact model path match
                    for model_config in &config_file.models {
                        if model_config.path == model_path {
                            return model_config.params.clone();
                        }
                    }
                    // No exact match, use size category defaults
                    if let Some(default) = config_file.size_category_defaults.get("large") {
                        return default.clone();
                    }
                }
                Err(e) => {
                    eprintln!("Failed to parse model-config.json: {}", e);
                }
            }
        }
        Err(e) => {
            eprintln!("Failed to read model-config.json: {}", e);
        }
    }

    default_params
}

fn find_gguf_model() -> Option<String> {
    let primary_dir = PathBuf::from("D:\\Users\\CASE\\models");
    if primary_dir.exists() {
        if let Ok(entries) = fs::read_dir(&primary_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                    if ext.eq_ignore_ascii_case("gguf") {
                        return Some(path.to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    let model_dirs: Vec<PathBuf> = vec![
        PathBuf::from("D:\\models"),
        PathBuf::from("D:\\AI\\models"),
        PathBuf::from("C:\\models"),
    ];

    for dir_path in model_dirs {
        if dir_path.exists() {
            if let Ok(entries) = fs::read_dir(&dir_path) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                        if ext.eq_ignore_ascii_case("gguf") {
                            return Some(path.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }
    }

    None
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlamaServerStatus {
    pub running: bool,
    pub url: String,
    pub healthy: bool,
    pub message: String,
}

#[tauri::command]
async fn check_llama_server_status() -> Result<LlamaServerStatus, String> {
    let url = format!("{}/health", LLAMA_CPP_SERVER_URL);
    let client = reqwest::Client::new();

    match client.get(&url).timeout(std::time::Duration::from_secs(2)).send().await {
        Ok(resp) if resp.status().is_success() => {
            Ok(LlamaServerStatus {
                running: true,
                healthy: true,
                url: LLAMA_CPP_SERVER_URL.to_string(),
                message: "Server is running and healthy".to_string(),
            })
        }
        Ok(resp) => Ok(LlamaServerStatus {
            running: false,
            healthy: false,
            url: LLAMA_CPP_SERVER_URL.to_string(),
            message: format!("Server returned HTTP {}", resp.status()),
        }),
        Err(_) => Ok(LlamaServerStatus {
            running: false,
            healthy: false,
            url: LLAMA_CPP_SERVER_URL.to_string(),
            message: "Server is not running".to_string(),
        }),
    }
}

#[tauri::command]
async fn ensure_llama_server_running() -> Result<String, String> {
    let status = check_llama_server_status().await?;

    if status.running && status.healthy {
        return Ok("Server already running".to_string());
    }

    start_llama_server(None).await
}

#[tauri::command]
async fn scan_system_models() -> Result<ScanResult, String> {
    let mut models = Vec::new();
    let mut total_size: u64 = 0;
    let mut scan_paths = Vec::new();

    // Scan common model directories
    let model_dirs = vec![
        dirs::home_dir().map(|p| p.join("models")),
        dirs::home_dir().map(|p| p.join(".lmstudio/models")),
        dirs::home_dir().map(|p| p.join("AppData/Local/lm-studio/models")),
        Some(std::path::PathBuf::from("C:\\models")),
        Some(std::path::PathBuf::from("D:\\models")),
        Some(std::path::PathBuf::from("D:\\AI\\models")),
    ];

    for dir_opt in model_dirs {
        if let Some(dir) = dir_opt {
            if dir.exists() {
                scan_paths.push(dir.to_string_lossy().to_string());
                scan_directory_for_models(&dir, &mut models, &mut total_size);
            }
        }
    }

    let recommended_coding = recommend_coding_model(&models);
    let recommended_chat = recommend_chat_model(&models);

    Ok(ScanResult {
        total_models: models.len(),
        total_size_bytes: total_size,
        total_size_human: format_size(total_size),
        models,
        recommended_for_coding: recommended_coding,
        recommended_for_chat: recommended_chat,
        scan_paths,
    })
}

fn scan_directory_for_models(dir: &std::path::Path, models: &mut Vec<ModelInfo>, total_size: &mut u64) {
    for entry in walkdir::WalkDir::new(dir).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            if ["gguf", "ggml", "safetensors", "pt", "bin", "onnx"].contains(&ext.to_lowercase().as_str()) {
                if let Ok(metadata) = std::fs::metadata(path) {
                    let size = metadata.len();
                    *total_size += size;
                    models.push(ModelInfo {
                        path: path.to_string_lossy().to_string(),
                        filename: path.file_name().unwrap_or_default().to_string_lossy().to_string(),
                        size_bytes: size,
                        size_human: format_size(size),
                        model_type: ext.to_lowercase(),
                        estimated_params: "unknown".to_string(),
                        quality_score: 0.5,
                        source: "localfile".to_string(),
                    });
                }
            }
        }
    }
}

fn format_size(bytes: u64) -> String {
    if bytes >= 1024 * 1024 * 1024 * 1024 {
        format!("{:.1}TB", bytes as f64 / (1024.0 * 1024.0 * 1024.0 * 1024.0))
    } else if bytes >= 1024 * 1024 * 1024 {
        format!("{:.1}GB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
    } else if bytes >= 1024 * 1024 {
        format!("{:.1}MB", bytes as f64 / (1024.0 * 1024.0))
    } else {
        format!("{:.1}KB", bytes as f64 / 1024.0)
    }
}

fn recommend_coding_model(models: &[ModelInfo]) -> Option<String> {
    models
        .iter()
        .filter(|m| m.filename.to_lowercase().contains("code") || m.filename.to_lowercase().contains("coder") || m.filename.to_lowercase().contains("qwen"))
        .max_by(|a, b| a.size_bytes.partial_cmp(&b.size_bytes).unwrap_or(std::cmp::Ordering::Equal))
        .map(|m| m.filename.clone())
}

fn recommend_chat_model(models: &[ModelInfo]) -> Option<String> {
    models
        .iter()
        .filter(|m| !m.filename.to_lowercase().contains("code"))
        .max_by(|a, b| a.size_bytes.partial_cmp(&b.size_bytes).unwrap_or(std::cmp::Ordering::Equal))
        .map(|m| m.filename.clone())
}

#[tauri::command]
fn count_tokens(text: &str) -> Result<TokenCount, String> {
    let count: usize = text.len() / 4;
    let max_allowed: usize = 65536;
    let remaining = max_allowed.saturating_sub(count);

    Ok(TokenCount {
        count,
        max_allowed,
        remaining,
        is_safe: count < max_allowed,
    })
}

#[tauri::command]
async fn model_generate(
    _location: ModelLocation,
    prompt: String,
    system: Option<String>,
    _project_path: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(900))
        .build()
        .unwrap();

    let mut messages = Vec::new();
    if let Some(sys) = system {
        messages.push(serde_json::json!({ "role": "system", "content": sys }));
    }
    messages.push(serde_json::json!({ "role": "user", "content": prompt }));

    let payload = serde_json::json!({
        "model": HARD_CODED_MODEL,
        "messages": messages,
        "stream": true,
        "temperature": 0.7,
        "max_tokens": 65536
    });

    let (tx, mut rx) = mpsc::channel::<String>(100);
    let client_clone = client.clone();
    let url = std::env::var("LLAMA_CPP_BASE_URL").unwrap_or_else(|_| LLAMA_CPP_SERVER_URL.to_string());
    let server_url = url.clone();

    tokio::spawn(async move {
        // First check if server is running
        match client_clone
            .get(&format!("{}/health", server_url))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                // Server is healthy, proceed with generation
            }
            Ok(resp) => {
                let _ = tx.send(format!("Server error: HTTP {}", resp.status())).await;
                return;
            }
            Err(_) => {
                let _ = tx.send(format!(
                    "llama.cpp server is not running at {}. Please start the server.",
                    server_url
                )).await;
                return;
            }
        }

        match client_clone
            .post(format!("{}/v1/chat/completions", url))
            .json(&payload)
            .send()
            .await
        {
            Ok(resp) => {
                let mut stream = resp.bytes_stream();
                use futures::StreamExt;
                let mut line_buffer = String::new();
                while let Some(chunk) = stream.next().await {
                    if let Ok(bytes) = chunk {
                        if let Ok(text) = String::from_utf8(bytes.to_vec()) {
                            line_buffer.push_str(&text);
                            while let Some(pos) = line_buffer.find('\n') {
                                let line = line_buffer[..pos].trim().to_string();
                                line_buffer = line_buffer[pos + 1..].to_string();
                                if line.starts_with("data: ") {
                                    let data = &line[6..];
                                    if data == "[DONE]" {
                                        break;
                                    }
                                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                                        if let Some(content) = json["choices"][0]["delta"]["content"].as_str() {
                                            let _ = tx.send(content.to_string()).await;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            Err(e) => {
                let _ = tx.send(format!("Error: {}", e)).await;
            }
        }
    });

    let mut full = String::new();
    while let Some(token) = rx.recv().await {
        full.push_str(&token);
        let _ = app_handle.emit("model-token", &token);
    }
    let _ = app_handle.emit("model-done", &full);
    Ok(full)
}

fn get_github_token() -> Option<String> {
    if let Ok(token) = std::env::var("GITHUB_TOKEN") {
        if !token.is_empty() {
            return Some(token);
        }
    }

    if let Ok(env_contents) = fs::read_to_string(".env") {
        for line in env_contents.lines() {
            if line.starts_with("GITHUB_TOKEN=") {
                let token = line.trim_start_matches("GITHUB_TOKEN=").trim().to_string();
                if !token.is_empty() {
                    return Some(token);
                }
            }
        }
    }

    None
}

fn get_output_dir() -> String {
    std::env::var("NEMOTRON_OUTPUT_DIR")
        .unwrap_or_else(|_| {
            dirs::home_dir()
                .map(|p| p.join("Projects").to_string_lossy().to_string())
                .unwrap_or_else(|| "D:\\Users\\CASE\\Projects".to_string())
        })
}

#[tauri::command]
async fn create_github_repo(
    name: String,
    description: String,
    private: bool,
) -> Result<String, String> {
    let token = get_github_token().ok_or_else(|| {
        "GitHub token not found. Please set GITHUB_TOKEN in .env file".to_string()
    })?;

    let client = reqwest::Client::new();
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("token {}", token)).unwrap(),
    );
    headers.insert(USER_AGENT, HeaderValue::from_static("nemotron"));

    let payload = serde_json::json!({
        "name": name,
        "description": description,
        "private": private,
        "auto_init": true
    });

    let resp = client
        .post("https://api.github.com/user/repos")
        .headers(headers)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("GitHub API request failed: {}", e))?;

    if resp.status().is_success() {
        let json: serde_json::Value = resp.json().await.unwrap();
        let clone_url = json["clone_url"].as_str().unwrap_or("").to_string();
        Ok(clone_url)
    } else {
        let error = resp.text().await.unwrap_or_default();
        Err(format!("GitHub API error: {}", error))
    }
}

#[tauri::command]
async fn build_and_push_project(
    project_name: String,
    description: String,
    files: Vec<GeneratedFile>,
    private: bool,
    output_dir: Option<String>,
) -> Result<BuildResult, String> {
    // Validate GitHub token exists (used by create_github_repo)
    let _token = get_github_token().ok_or_else(|| {
        "GitHub token not found. Please set GITHUB_TOKEN in .env file".to_string()
    })?;

    let base_dir = output_dir.unwrap_or_else(get_output_dir);
    let project_path = PathBuf::from(&base_dir).join(&project_name);

    fs::create_dir_all(&project_path)
        .map_err(|e| format!("Failed to create project directory: {}", e))?;

    for file in &files {
        let file_path = project_path.join(&file.path);

        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory for {}: {}", file.path, e))?;
        }

        fs::write(&file_path, &file.content)
            .map_err(|e| format!("Failed to write {}: {}", file.path, e))?;
    }

    let clone_url = create_github_repo(project_name.clone(), description, private).await?;

    let mut init_opts = RepositoryInitOptions::new();
    init_opts.initial_head("main");

    let repo = Repository::init_opts(&project_path, &init_opts)
        .map_err(|e| format!("Failed to init git repo: {}", e))?;

    let mut index = repo.index()
        .map_err(|e| format!("Failed to get git index: {}", e))?;

    index.add_all(["*"].iter(), IndexAddOption::DEFAULT, None)
        .map_err(|e| format!("Failed to add files to git: {}", e))?;

    index.write()
        .map_err(|e| format!("Failed to write git index: {}", e))?;

    let tree_id = index.write_tree()
        .map_err(|e| format!("Failed to write tree: {}", e))?;

    let tree = repo.find_tree(tree_id)
        .map_err(|e| format!("Failed to find tree: {}", e))?;

    let signature = Signature::now("Nemotron", "nemotron@local")
        .map_err(|e| format!("Failed to create signature: {}", e))?;

    repo.commit(
        Some("HEAD"),
        &signature,
        &signature,
        &format!("Initial commit: {}", project_name),
        &tree,
        &[],
    )
    .map_err(|e| format!("Failed to create commit: {}", e))?;

    repo.remote("origin", &clone_url)
        .map_err(|e| format!("Failed to add remote: {}", e))?;

    let mut fetch_options = git2::FetchOptions::new();
    let mut push_options = git2::PushOptions::new();
    push_options.remote_callbacks(git2::RemoteCallbacks::new());

    let mut remote = repo.find_remote("origin")
        .map_err(|e| format!("Failed to find remote: {}", e))?;

    remote.fetch(&["main"], Some(&mut fetch_options), None)
        .map_err(|e| format!("Failed to fetch: {}", e))?;

    remote.push(&["refs/heads/main:refs/heads/main"], Some(&mut push_options))
        .map_err(|e| format!("Failed to push: {}", e))?;

    Ok(BuildResult {
        success: true,
        local_path: project_path.to_string_lossy().to_string(),
        repo_url: Some(clone_url),
        message: format!("Project '{}' built and pushed successfully!", project_name),
    })
}

#[tauri::command]
fn get_templates() -> Vec<ProjectTemplate> {
    vec![
        ProjectTemplate {
            id: "python-cli".to_string(),
            name: "Python CLI Tool".to_string(),
            description: "Command-line interface with argparse".to_string(),
        },
        ProjectTemplate {
            id: "fastapi-backend".to_string(),
            name: "FastAPI Backend".to_string(),
            description: "REST API with FastAPI and PostgreSQL".to_string(),
        },
        ProjectTemplate {
            id: "react-frontend".to_string(),
            name: "React Frontend".to_string(),
            description: "Modern React app with Vite".to_string(),
        },
    ]
}

#[tauri::command]
fn get_skills() -> Vec<Skill> {
    vec![
        Skill {
            id: "clean-code".to_string(),
            name: "Clean Code".to_string(),
            description: "Write maintainable, readable code".to_string(),
        },
        Skill {
            id: "test-driven".to_string(),
            name: "Test-Driven Development".to_string(),
            description: "Write tests first, then implementation".to_string(),
        },
    ]
}

#[tauri::command]
fn template_to_files(template_id: String, _project_name: String, _description: String) -> Result<Vec<GeneratedFile>, String> {
    let files = match template_id.as_str() {
        "python-cli" => {
            vec![
                GeneratedFile {
                    path: "main.py".to_string(),
                    content: r#"#!/usr/bin/env python3
import argparse

def main():
    parser = argparse.ArgumentParser(description="CLI Tool")
    parser.add_argument("--name", type=str, help="Your name")
    args = parser.parse_args()

    if args.name:
        print(f"Hello, {args.name}!")
    else:
        print("Hello, World!")

if __name__ == "__main__":
    main()
"#.to_string(),
                },
                GeneratedFile {
                    path: "requirements.txt".to_string(),
                    content: "".to_string(),
                },
            ]
        }
        _ => {
            return Err(format!("Unknown template: {}", template_id));
        }
    };

    Ok(files)
}

#[tauri::command]
fn read_file_content(path: String) -> Result<String, String> {
    fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", path, e))
}

#[tauri::command]
fn list_tracked_projects() -> Vec<ProjectRecord> {
    vec![]
}

#[tauri::command]
fn test_sandbox_environment() -> Result<SandboxTestResult, String> {
    Ok(SandboxTestResult {
        python_version: "3.x".to_string(),
        node_version: "20.x".to_string(),
        npm_version: "10.x".to_string(),
        cargo_version: "1.x".to_string(),
        git_version: "2.x".to_string(),
        working_directory: std::env::current_dir().unwrap().to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn save_github_token(token: String) -> Result<(), String> {
    let env_path = ".env";
    let mut content = String::new();

    if let Ok(existing) = fs::read_to_string(env_path) {
        for line in existing.lines() {
            if !line.starts_with("GITHUB_TOKEN=") {
                content.push_str(line);
                content.push('\n');
            }
        }
    }

    content.push_str(&format!("GITHUB_TOKEN={}\n", token));

    fs::write(env_path, content)
        .map_err(|e| format!("Failed to save token: {}", e))?;

    Ok(())
}

#[tauri::command]
fn get_github_token_status() -> Result<bool, String> {
    Ok(get_github_token().is_some())
}

#[tauri::command]
fn clear_github_token() -> Result<(), String> {
    let env_path = ".env";
    let mut content = String::new();

    if let Ok(existing) = fs::read_to_string(env_path) {
        for line in existing.lines() {
            if !line.starts_with("GITHUB_TOKEN=") {
                content.push_str(line);
                content.push('\n');
            }
        }
    }

    fs::write(env_path, content)
        .map_err(|e| format!("Failed to clear token: {}", e))?;

    Ok(())
}

#[tauri::command]
fn get_github_user_info() -> Result<GithubUserInfo, String> {
    Ok(GithubUserInfo {
        login: "user".to_string(),
        avatar_url: "".to_string(),
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectTemplate {
    pub id: String,
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectRecord {
    pub name: String,
    pub path: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxTestResult {
    pub python_version: String,
    pub node_version: String,
    pub npm_version: String,
    pub cargo_version: String,
    pub git_version: String,
    pub working_directory: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GithubUserInfo {
    pub login: String,
    pub avatar_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuildProjectRequest {
    pub project_name: String,
    pub description: String,
    pub files: Vec<GeneratedFile>,
    pub private: bool,
    pub output_dir: Option<String>,
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_system_metrics,
            locate_model,
            start_llama_server,
            check_llama_server_status,
            ensure_llama_server_running,
            scan_system_models,
            count_tokens,
            model_generate,
            get_templates,
            get_skills,
            template_to_files,
            read_file_content,
            list_tracked_projects,
            test_sandbox_environment,
            build_and_push_project,
            save_github_token,
            get_github_token_status,
            clear_github_token,
            get_github_user_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
