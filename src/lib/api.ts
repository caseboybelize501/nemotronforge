import { invoke } from '@tauri-apps/api/core';
import type {
  QwenLocation, GeneratedFile, ProjectTemplate, BuildProjectRequest, BuildResult,
  ProjectRecord, Skill, TokenCount, ModelInfo, ScanResult
} from '../types';

export const locateQwen = () =>
  invoke<QwenLocation>('locate_qwen');

export const qwenGenerate = (location: QwenLocation, prompt: string, system?: string, projectPath?: string | null) =>
  invoke<string>('qwen_generate', { location, prompt, system: system ?? null, projectPath: projectPath ?? null });

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
  invoke<BuildResult>('build_and_push_project', { req });

export const readFileContent = (path: string) =>
  invoke<string>('read_file_content', { path });

export const listTrackedProjects = () =>
  invoke<ProjectRecord[]>('list_tracked_projects');
