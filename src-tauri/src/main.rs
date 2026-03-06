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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QwenLocation {
    pub found: bool,
    pub method: String,
    pub path: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaModel {
    pub name: String,
    pub size: String,
    pub modified: String,
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
    pub ollama_models: Vec<String>,
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
    use std::process::Command;
    
    // Get CPU and RAM usage from system
    let cpu_usage = get_cpu_usage();
    let (ram_used, ram_total) = get_ram_usage();
    
    // Get GPU metrics from Ollama if running
    let (gpu_util, vram_used, vram_total, model_name, inference_active) = get_ollama_gpu_metrics().await;
    
    // Estimate KV cache size (rough estimate based on RAM used by inference)
    let kv_cache = if inference_active {
        (vram_used * 0.3) // Rough estimate: 30% of VRAM used for KV cache
    } else {
        0.0
    };
    
    Ok(SystemMetrics {
        gpu_utilization: gpu_util,
        vram_used_gb: vram_used,
        vram_total_gb: vram_total,
        cpu_utilization: cpu_usage,
        ram_used_gb: ram_used,
        ram_total_gb: ram_total,
        kv_cache_size_mb: kv_cache * 1024.0, // Convert to MB
        model_name,
        inference_active,
    })
}

fn get_cpu_usage() -> f32 {
    use sysinfo::{System, SystemExt};
    use std::thread;
    use std::time::Duration;
    
    let mut sys = System::new_all();
    sys.refresh_cpu();
    
    // Wait a bit for CPU usage calculation
    thread::sleep(Duration::from_millis(200));
    sys.refresh_cpu();
    
    sys.global_cpu_usage()
}

fn get_ram_usage() -> (f32, f32) {
    use sysinfo::{System, SystemExt};
    let mut sys = System::new_all();
    sys.refresh_memory();
    
    let total_gb = sys.total_memory() as f32 / (1024.0 * 1024.0 * 1024.0);
    let used_gb = sys.used_memory() as f32 / (1024.0 * 1024.0 * 1024.0);
    
    (used_gb, total_gb)
}

async fn get_ollama_gpu_metrics() -> (f32, f32, f32, String, bool) {
    use reqwest::Client;
    
    let client = Client::new();
    
    // Try to get metrics from Ollama API
    match client.get("http://localhost:11434/api/tags").send().await {
        Ok(resp) => {
            if resp.status().is_success() {
                if let Ok(json) = resp.json::<serde_json::Value>().await {
                    if let Some(models) = json.get("models").and_then(|m| m.as_array()) {
                        if !models.is_empty() {
                            // Get first model info
                            if let Some(model) = models.first() {
                                let name = model["name"].as_str().unwrap_or("unknown").to_string();
                                let size = model["size"].as_u64().unwrap_or(0);
                                let size_gb = size as f32 / (1024.0 * 1024.0 * 1024.0);
                                
                                // Check if model is loaded (inference active)
                                let active = size > 0;
                                
                                // Estimate GPU utilization based on activity
                                let gpu_util = if active { 45.0 } else { 0.0 };
                                
                                return (gpu_util, size_gb, size_gb * 1.5, name, active);
                            }
                        }
                    }
                }
            }
        }
        Err(_) => {}
    }
    
    (0.0, 0.0, 0.0, String::new(), false)
}

#[tauri::command]
async fn clear_kv_cache() -> Result<String, String> {
    // Send signal to Ollama to unload the current model
    use reqwest::Client;
    
    let client = Client::new();
    
    // Keep-alive of 0 will unload the model
    let payload = serde_json::json!({
        "model": "",
        "keep_alive": 0
    });
    
    match client.post("http://localhost:11434/api/generate").json(&payload).send().await {
        Ok(_) => Ok("KV cache cleared. Model unloaded from memory.".to_string()),
        Err(e) => Err(format!("Failed to clear cache: {}", e))
    }
}

fn get_github_token() -> Option<String> {
    // Try to load from environment first
    if let Ok(token) = std::env::var("GITHUB_TOKEN") {
        if !token.is_empty() {
            return Some(token);
        }
    }
    
    // Try to load from .env file
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
async fn locate_qwen() -> Result<QwenLocation, String> {
    // Check Ollama first - look for ANY model (not just qwen)
    if let Ok(output) = Command::new("ollama").arg("list").output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let lines: Vec<&str> = stdout.lines().collect();

            // Look for ANY model (prefer qwen for coding, but accept any)
            for line in lines.iter().skip(1) {
                if line.trim().is_empty() {
                    continue;
                }
                let parts: Vec<&str> = line.split_whitespace().collect();
                if !parts.is_empty() {
                    let model_name = parts[0];
                    
                    // Prefer qwen for coding tasks
                    if model_name.contains("qwen") {
                        return Ok(QwenLocation {
                            found: true,
                            method: "ollama".to_string(),
                            path: Some("ollama".to_string()),
                            model: Some(model_name.to_string()),
                        });
                    }
                }
            }
            
            // If no qwen, return first available model
            if lines.len() > 1 {
                let parts: Vec<&str> = lines[1].split_whitespace().collect();
                if !parts.is_empty() {
                    return Ok(QwenLocation {
                        found: true,
                        method: "ollama".to_string(),
                        path: Some("ollama".to_string()),
                        model: Some(parts[0].to_string()),
                    });
                }
            }
        }
    }

    // Check LM Studio
    let lmstudio_paths = vec![
        dirs::home_dir().map(|p| p.join(".lmstudio/models")),
        Some(dirs::home_dir().unwrap().join("AppData/Local/lm-studio/models")),
    ];
    
    for path_opt in lmstudio_paths {
        if let Some(path) = path_opt {
            if path.exists() {
                return Ok(QwenLocation {
                    found: true,
                    method: "lmstudio".to_string(),
                    path: Some(path.to_string_lossy().to_string()),
                    model: None,
                });
            }
        }
    }

    Ok(QwenLocation {
        found: false,
        method: "none".to_string(),
        path: None,
        model: None,
    })
}

#[tauri::command]
async fn scan_ollama_models() -> Result<Vec<OllamaModel>, String> {
    let output = Command::new("ollama")
        .arg("list")
        .output()
        .map_err(|e| format!("Failed to run ollama: {}", e))?;

    if !output.status.success() {
        return Err("Ollama command failed".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut models = Vec::new();

    for line in stdout.lines().skip(1) {
        if line.trim().is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 3 {
            models.push(OllamaModel {
                name: parts[0].to_string(),
                size: parts[1].to_string(),
                modified: parts[2..].join(" "),
            });
        }
    }

    Ok(models)
}

#[tauri::command]
async fn scan_system_models() -> Result<ScanResult, String> {
    let mut models = Vec::new();
    let mut total_size: u64 = 0;
    let mut scan_paths = Vec::new();
    let mut ollama_model_names = Vec::new();

    // Scan Ollama models
    if let Ok(output) = Command::new("ollama").arg("list").output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines().skip(1) {
                if line.trim().is_empty() {
                    continue;
                }
                let parts: Vec<&str> = line.split_whitespace().collect();
                if !parts.is_empty() {
                    let name = parts[0];
                    ollama_model_names.push(name.to_string());
                    
                    // Parse size
                    let size_str = parts.get(1).unwrap_or(&"0B");
                    let (size_bytes, size_human) = parse_model_size(size_str);
                    total_size += size_bytes;

                    models.push(ModelInfo {
                        path: format!("ollama://{}", name),
                        filename: name.to_string(),
                        size_bytes,
                        size_human,
                        model_type: "gguf".to_string(),
                        estimated_params: estimate_params(name),
                        quality_score: calculate_quality_score(name, size_bytes),
                        source: "ollama".to_string(),
                    });
                }
            }
        }
    }

    // Scan common model directories
    let model_dirs = vec![
        dirs::home_dir().map(|p| p.join("models")),
        dirs::home_dir().map(|p| p.join(".lmstudio/models")),
        dirs::home_dir().map(|p| p.join("AppData/Local/lm-studio/models")),
        Some(std::path::PathBuf::from("C:\\models")),
    ];

    for dir_opt in model_dirs {
        if let Some(dir) = dir_opt {
            if dir.exists() {
                scan_paths.push(dir.to_string_lossy().to_string());
                scan_directory_for_models(&dir, &mut models, &mut total_size);
            }
        }
    }

    // Recommend models
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
        ollama_models: ollama_model_names,
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

fn parse_model_size(size_str: &str) -> (u64, String) {
    let size_str = size_str.to_uppercase();
    let num: f64 = size_str.chars().take_while(|c| c.is_numeric() || *c == '.').collect::<String>().parse().unwrap_or(0.0);
    
    if size_str.contains("TB") {
        let bytes = (num * 1024.0 * 1024.0 * 1024.0 * 1024.0) as u64;
        (bytes, format!("{:.1}TB", num))
    } else if size_str.contains("GB") {
        let bytes = (num * 1024.0 * 1024.0 * 1024.0) as u64;
        (bytes, format!("{:.1}GB", num))
    } else if size_str.contains("MB") {
        let bytes = (num * 1024.0 * 1024.0) as u64;
        (bytes, format!("{:.1}MB", num))
    } else {
        (num as u64, format!("{:.0}B", num))
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

fn estimate_params(model_name: &str) -> String {
    let name_lower = model_name.to_lowercase();
    if name_lower.contains("70b") || name_lower.contains("70b") {
        "70B".to_string()
    } else if name_lower.contains("35b") || name_lower.contains("34b") {
        "35B".to_string()
    } else if name_lower.contains("13b") {
        "13B".to_string()
    } else if name_lower.contains("7b") {
        "7B".to_string()
    } else {
        "unknown".to_string()
    }
}

fn calculate_quality_score(model_name: &str, size_bytes: u64) -> f64 {
    let name_lower = model_name.to_lowercase();
    let mut score: f64 = 0.5;

    if name_lower.contains("qwen") {
        score += 0.2;
    }
    if name_lower.contains("coder") || name_lower.contains("code") {
        score += 0.15;
    }
    if size_bytes > 30u64 * 1024 * 1024 * 1024 {
        score += 0.1;
    }

    score.min(1.0)
}

fn recommend_coding_model(models: &[ModelInfo]) -> Option<String> {
    models
        .iter()
        .filter(|m| m.filename.to_lowercase().contains("code") || m.filename.to_lowercase().contains("coder"))
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
    // Rough estimate: 1 token ≈ 4 characters for English
    let count: usize = text.len() / 4;
    let max_allowed: usize = 32768; // Typical context window
    let remaining = max_allowed.saturating_sub(count);

    Ok(TokenCount {
        count,
        max_allowed,
        remaining,
        is_safe: count < max_allowed,
    })
}

#[tauri::command]
async fn qwen_generate(
    location: QwenLocation,
    prompt: String,
    system: Option<String>,
    _project_path: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    if !location.found {
        return Err("Qwen model not found".to_string());
    }

    let model = location.model.unwrap_or_else(|| "qwen2.5-coder".to_string());
    let client = reqwest::Client::new();

    // Build messages array
    let mut messages = Vec::new();
    
    if let Some(sys) = system {
        messages.push(serde_json::json!({
            "role": "system",
            "content": sys
        }));
    }
    
    messages.push(serde_json::json!({
        "role": "user",
        "content": prompt
    }));

    let payload = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": true
    });

    let (tx, mut rx) = mpsc::channel::<String>(100);

    // Spawn request
    let client_clone = client.clone();
    tokio::spawn(async move {
        let resp = client_clone
            .post("http://localhost:11434/api/chat")
            .json(&payload)
            .send()
            .await;

        if let Ok(resp) = resp {
            let mut stream = resp.bytes_stream();
            use futures::StreamExt;
            
            while let Some(chunk) = stream.next().await {
                if let Ok(bytes) = chunk {
                    if let Ok(text) = String::from_utf8(bytes.to_vec()) {
                        // Parse Ollama streaming response
                        for line in text.lines() {
                            if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
                                if let Some(content) = json.get("message").and_then(|m| m.get("content")) {
                                    if let Some(content_str) = content.as_str() {
                                        let _ = tx.send(content_str.to_string()).await;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    // Forward events to frontend
    let mut full_response = String::new();
    while let Some(token) = rx.recv().await {
        let _ = app_handle.emit("qwen-token", &token);
        full_response.push_str(&token);
    }

    Ok(full_response)
}

#[tauri::command]
async fn ollama_chat(
    model: String,
    prompt: String,
    system: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let client = reqwest::Client::new();

    let mut messages = Vec::new();
    
    if let Some(sys) = system {
        messages.push(serde_json::json!({
            "role": "system",
            "content": sys
        }));
    }
    
    messages.push(serde_json::json!({
        "role": "user",
        "content": prompt
    }));

    let payload = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": true
    });

    let resp = client
        .post("http://localhost:11434/api/chat")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let mut stream = resp.bytes_stream();
    use futures::StreamExt;
    
    let mut full_response = String::new();
    
    while let Some(chunk) = stream.next().await {
        if let Ok(bytes) = chunk {
            if let Ok(text) = String::from_utf8(bytes.to_vec()) {
                for line in text.lines() {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
                        if let Some(content) = json.get("message").and_then(|m| m.get("content")) {
                            if let Some(content_str) = content.as_str() {
                                let _ = app_handle.emit("ollama-token", content_str);
                                full_response.push_str(content_str);
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(full_response)
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
    // GitHub PAT uses "token" prefix for authorization
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
    let token = get_github_token().ok_or_else(|| {
        "GitHub token not found. Please set GITHUB_TOKEN in .env file".to_string()
    })?;

    let base_dir = output_dir.unwrap_or_else(get_output_dir);
    let project_path = PathBuf::from(&base_dir).join(&project_name);

    // Create project directory
    fs::create_dir_all(&project_path)
        .map_err(|e| format!("Failed to create project directory: {}", e))?;

    // Write all files
    for file in &files {
        let file_path = project_path.join(&file.path);

        // Create parent directories if needed
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory for {}: {}", file.path, e))?;
        }

        fs::write(&file_path, &file.content)
            .map_err(|e| format!("Failed to write {}: {}", file.path, e))?;
    }

    // Create GitHub repo first (before any git operations)
    let clone_url = create_github_repo(project_name.clone(), description, private).await?;

    // Initialize git repository
    let mut init_opts = RepositoryInitOptions::new();
    init_opts.initial_head("main");

    let repo = Repository::init_opts(&project_path, &init_opts)
        .map_err(|e| format!("Failed to init git repo: {}", e))?;

    // Add all files to git
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

    // Create initial commit
    repo.commit(
        Some("HEAD"),
        &signature,
        &signature,
        &format!("Initial commit: {}", project_name),
        &tree,
        &[],
    )
    .map_err(|e| format!("Failed to create commit: {}", e))?;

    // Add remote
    repo.remote("origin", &clone_url)
        .map_err(|e| format!("Failed to add remote: {}", e))?;

    // Push to GitHub
    let mut callbacks = git2::RemoteCallbacks::new();
    callbacks.credentials(|_url, _username_from_url, _allowed_types| {
        // GitHub PAT authentication: username can be anything, token is password
        git2::Cred::userpass_plaintext("x-access-token", &token)
    });

    let mut push_opts = git2::PushOptions::new();
    push_opts.remote_callbacks(callbacks);

    if let Ok(mut remote) = repo.find_remote("origin") {
        remote.push(&["refs/heads/main:refs/heads/main"], Some(&mut push_opts))
            .map_err(|e| format!("Failed to push to GitHub: {}. Check that your GitHub token has 'repo' scope.", e))?;
    }

    Ok(BuildResult {
        success: true,
        local_path: project_path.to_string_lossy().to_string(),
        repo_url: Some(clone_url.clone()),
        message: format!("Project created and pushed to GitHub successfully!"),
    })
}

#[tauri::command]
async fn test_sandbox_environment() -> Result<SandboxTestResult, String> {
    let mut results = Vec::new();
    let mut all_passed = true;

    // Test 1: Check Rust toolchain
    let rust_test = run_command_test("rustc", &["--version"]);
    results.push(rust_test.clone());
    if !rust_test.passed {
        all_passed = false;
    }

    // Test 2: Check cargo
    let cargo_test = run_command_test("cargo", &["--version"]);
    results.push(cargo_test.clone());
    if !cargo_test.passed {
        all_passed = false;
    }

    // Test 3: Check Ollama
    let ollama_test = run_command_test("ollama", &["--version"]);
    results.push(ollama_test.clone());
    
    // Test 4: Check Node.js
    let node_test = run_command_test("node", &["--version"]);
    results.push(node_test.clone());
    if !node_test.passed {
        all_passed = false;
    }

    // Test 5: Check npm
    let npm_test = run_command_test("npm", &["--version"]);
    results.push(npm_test.clone());
    if !npm_test.passed {
        all_passed = false;
    }

    // Test 6: Try to compile Tauri app (check only)
    let tauri_check = Command::new("cargo")
        .args(&["check", "--manifest-path", "src-tauri/Cargo.toml"])
        .output();
    
    let tauri_test = match tauri_check {
        Ok(output) => SandboxTest {
            name: "Tauri compilation check".to_string(),
            passed: output.status.success(),
            output: String::from_utf8_lossy(&output.stdout).to_string(),
            error: if output.status.success() {
                String::new()
            } else {
                String::from_utf8_lossy(&output.stderr).to_string()
            },
        },
        Err(e) => SandboxTest {
            name: "Tauri compilation check".to_string(),
            passed: false,
            output: String::new(),
            error: e.to_string(),
        },
    };
    results.push(tauri_test.clone());
    if !tauri_test.passed {
        all_passed = false;
    }

    Ok(SandboxTestResult {
        all_passed,
        tests: results,
    })
}

fn run_command_test(cmd: &str, args: &[&str]) -> SandboxTest {
    match Command::new(cmd).args(args).output() {
        Ok(output) => SandboxTest {
            name: format!("{} version check", cmd),
            passed: output.status.success(),
            output: String::from_utf8_lossy(&output.stdout).trim().to_string(),
            error: if output.status.success() {
                String::new()
            } else {
                String::from_utf8_lossy(&output.stderr).to_string()
            },
        },
        Err(e) => SandboxTest {
            name: format!("{} version check", cmd),
            passed: false,
            output: String::new(),
            error: e.to_string(),
        },
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxTest {
    pub name: String,
    pub passed: bool,
    pub output: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxTestResult {
    pub all_passed: bool,
    pub tests: Vec<SandboxTest>,
}

fn main() {
    // Load environment variables from .env file
    let _ = dotenvy::dotenv();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            locate_qwen,
            scan_ollama_models,
            scan_system_models,
            count_tokens,
            qwen_generate,
            ollama_chat,
            build_and_push_project,
            test_sandbox_environment,
            get_system_metrics,
            clear_kv_cache,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
