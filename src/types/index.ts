export interface QwenLocation {
  found: boolean;
  method: 'ollama' | 'lmstudio' | 'binary' | 'ollama_no_model' | 'none';
  path: string | null;
  model: string | null;
}

export interface OllamaModel {
  name: string;
  size: string;
  modified: string;
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  language: string;
  tags: string[];
  structure: { path: string; content: string }[];
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  prompt: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  path: string;
  remote_url?: string;
  tech_stack: string[];
  last_modified: number;
}

export interface BuildProjectRequest {
  project_name: string;
  description: string;
  template_id: string | null;
  freeform_prompt: string | null;
  generated_files: GeneratedFile[];
  private_repo: boolean;
  output_dir: string;
}

export interface BuildResult {
  success: boolean;
  local_path: string;
  repo_url: string | null;
  message: string;
}

export interface TokenCount {
  count: number;
  max_allowed: number;
  remaining: number;
  is_safe: boolean;
  warning?: string;
}

export interface ModelInfo {
  path: string;
  filename: string;
  size_bytes: number;
  size_human: string;
  model_type: 'gguf' | 'ggml' | 'safetensors' | 'pytorch' | 'onnx' | 'other';
  estimated_params: string;
  quality_score: number;
  source: 'ollama' | 'lmstudio' | 'localfile';
}

export interface ScanResult {
  total_models: number;
  total_size_bytes: number;
  total_size_human: string;
  models: ModelInfo[];
  recommended_for_coding: string | null;
  recommended_for_chat: string | null;
  scan_paths: string[];
  ollama_models: string[];
}

export interface SandboxTest {
  name: string;
  passed: boolean;
  output: string;
  error: string;
}

export interface SandboxTestResult {
  all_passed: boolean;
  tests: SandboxTest[];
}

export interface SystemMetrics {
  gpu_utilization: number;
  vram_used_gb: number;
  vram_total_gb: number;
  cpu_utilization: number;
  ram_used_gb: number;
  ram_total_gb: number;
  kv_cache_size_mb: number;
  model_name: string;
  inference_active: boolean;
}
