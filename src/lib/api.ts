import { invoke } from '@tauri-apps/api/core';
import type {
  ModelLocation, GeneratedFile, ProjectTemplate, BuildProjectRequest, BuildResult,
  ProjectRecord, Skill, TokenCount, ScanResult, SandboxTestResult,
  SystemMetrics, LlamaServerStatus, GithubUserInfo
} from '../types';

export const locateModel = () =>
  invoke<ModelLocation>('locate_model');

export const modelGenerate = (location: ModelLocation, prompt: string, system?: string, projectPath?: string | null) =>
  invoke<string>('model_generate', { location, prompt, system: system ?? null, projectPath: projectPath ?? null });

export const scanSystemModels = () =>
  invoke<ScanResult>('scan_system_models');

export const countTokens = (text: string) =>
  invoke<TokenCount>('count_tokens', { text });

export const getTemplates = () =>
  invoke<ProjectTemplate[]>('get_templates');

export const getSkills = () =>
  invoke<Skill[]>('get_skills');

export const templateToFiles = (templateId: string, projectName: string, description: string) =>
  invoke<GeneratedFile[]>('template_to_files', { templateId, projectName, description });

export const buildAndPushProject = (req: BuildProjectRequest) =>
  invoke<BuildResult>('build_and_push_project', {
    projectName: req.project_name,
    description: req.description,
    files: req.generated_files,
    private: req.private_repo,
    outputDir: req.output_dir,
    pushToGithub: req.push_to_github ?? true,
  });

export const readFileContent = (path: string) =>
  invoke<string>('read_file_content', { path });

export const listTrackedProjects = () =>
  invoke<ProjectRecord[]>('list_tracked_projects');

export const testSandboxEnvironment = () =>
  invoke<SandboxTestResult>('test_sandbox_environment');

export const getSystemMetrics = () =>
  invoke<SystemMetrics>('get_system_metrics');

export const saveGithubToken = (token: string) =>
  invoke<void>('save_github_token', { token });

export const getGithubTokenStatus = () =>
  invoke<boolean>('get_github_token_status');

export const getGithubUserInfo = () =>
  invoke<GithubUserInfo>('get_github_user_info');

export const clearGithubToken = () =>
  invoke<void>('clear_github_token');

// llama.cpp Server Management
export const checkLlamaServerStatus = () =>
  invoke<LlamaServerStatus>('check_llama_server_status');

export const startLlamaServer = (modelPath?: string) =>
  invoke<string>('start_llama_server', { modelPath: modelPath ?? null });

export const ensureLlamaServerRunning = () =>
  invoke<string>('ensure_llama_server_running');
