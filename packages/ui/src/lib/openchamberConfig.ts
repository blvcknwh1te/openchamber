/**
 * Client for the project setup routes: worktree setup commands, project
 * actions, and pinned draft starters.
 *
 * The values live in `~/.config/openchamber/projects/<projectId>.json`, owned
 * by the server (`packages/web/server/lib/projects/project-setup.js`) and by
 * the VS Code extension host (`packages/vscode/src/project-setup.ts`). This
 * module only speaks HTTP: it resolves no home directory and composes no path,
 * so the same code serves web, desktop, VS Code, and the phone, including a
 * phone driving a remote instance.
 *
 * Reads keep the contract callers were written against: a failed read logs
 * and resolves to the empty value, because worktree creation and the new
 * session screen must keep working when the config cannot be fetched. Writes
 * resolve `false` on failure.
 */

import { z } from 'zod';

import { sanitizeStarterRefs, type DraftStarterRef } from './draftStarters';
import { createProjectIdFromPath } from './projectId';
import { runtimeFetch } from './runtime-fetch';

type ProjectRef = { id: string; path: string };

type OpenChamberProjectActionPlatform = 'macos' | 'linux' | 'windows';

export interface OpenChamberProjectAction {
  id: string;
  name: string;
  command: string;
  icon?: string | null;
  runIn?: 'parent';
  platforms?: OpenChamberProjectActionPlatform[];
  autoOpenUrl?: boolean;
  openUrl?: string;
  desktopOpenSshForward?: string;
}

export interface OpenChamberProjectActionsState {
  actions: OpenChamberProjectAction[];
  primaryActionId: string | null;
}

/** The view the server returns; the server sanitizes, the client only checks the shape. */
const projectActionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  command: z.string().min(1),
  icon: z.string().nullable().optional(),
  runIn: z.literal('parent').optional(),
  platforms: z.array(z.enum(['macos', 'linux', 'windows'])).optional(),
  autoOpenUrl: z.literal(true).optional(),
  openUrl: z.string().optional(),
  desktopOpenSshForward: z.string().optional(),
});

const projectSetupSchema = z.object({
  setupWorktree: z.array(z.string()),
  setupWorktreeWait: z.boolean(),
  projectActions: z.array(projectActionSchema),
  projectActionsPrimaryId: z.string().nullable(),
  draftStarters: z.unknown().transform((value) => sanitizeStarterRefs(value)),
});

type ProjectSetup = z.infer<typeof projectSetupSchema>;

type ProjectSetupPatch = Partial<{
  setupWorktree: string[];
  setupWorktreeWait: boolean;
  projectActions: OpenChamberProjectAction[];
  projectActionsPrimaryId: string | null;
  draftStarters: DraftStarterRef[];
  projectPath: string;
}>;

const EMPTY_SETUP: ProjectSetup = {
  setupWorktree: [],
  setupWorktreeWait: false,
  projectActions: [],
  projectActionsPrimaryId: null,
  draftStarters: [],
};

/**
 * The storage id is derived from the project path, not from `project.id`:
 * project ids in settings have churned across versions, and the path-derived
 * id is what names the config file on disk.
 */
const resolveProjectSetupId = (project: ProjectRef): string => {
  const projectPath = typeof project?.path === 'string' ? project.path.trim() : '';
  return projectPath ? createProjectIdFromPath(projectPath) : '';
};

const endpointFor = (projectId: string): string => `/api/projects/${encodeURIComponent(projectId)}/config`;

const parseSetupResponse = async (response: Response): Promise<ProjectSetup> => {
  const parsed = projectSetupSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error('Project config response has an unexpected shape');
  }
  return parsed.data;
};

/** The project's setup, or the empty setup when it cannot be read. */
const readProjectSetup = async (project: ProjectRef): Promise<ProjectSetup> => {
  const projectId = resolveProjectSetupId(project);
  if (!projectId) return EMPTY_SETUP;
  try {
    const response = await runtimeFetch(endpointFor(projectId), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await parseSetupResponse(response);
  } catch (error) {
    console.warn('Failed to read project config:', error);
    return EMPTY_SETUP;
  }
};

const updateProjectSetup = async (project: ProjectRef, patch: ProjectSetupPatch): Promise<boolean> => {
  const projectId = resolveProjectSetupId(project);
  if (!projectId) return false;
  try {
    const response = await runtimeFetch(endpointFor(projectId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ...patch, projectPath: project.path.trim() }),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    await parseSetupResponse(response);
    return true;
  } catch (error) {
    console.warn('Failed to save project config:', error);
    return false;
  }
};

export async function getWorktreeSetupCommands(project: ProjectRef): Promise<string[]> {
  return (await readProjectSetup(project)).setupWorktree;
}

export async function saveWorktreeSetupCommands(project: ProjectRef, commands: string[]): Promise<boolean> {
  return updateProjectSetup(project, { setupWorktree: commands.filter((cmd) => cmd.trim().length > 0) });
}

export async function getWorktreeSetupWaitEnabled(project: ProjectRef): Promise<boolean> {
  return (await readProjectSetup(project)).setupWorktreeWait;
}

export async function saveWorktreeSetupWaitEnabled(project: ProjectRef, enabled: boolean): Promise<boolean> {
  return updateProjectSetup(project, { setupWorktreeWait: enabled });
}

/** This project's pinned draft welcome starters. */
export async function getProjectDraftStarters(project: ProjectRef): Promise<DraftStarterRef[]> {
  return (await readProjectSetup(project)).draftStarters;
}

export async function saveProjectDraftStarters(project: ProjectRef, starters: DraftStarterRef[]): Promise<boolean> {
  return updateProjectSetup(project, { draftStarters: sanitizeStarterRefs(starters) });
}

export async function getProjectActionsState(project: ProjectRef): Promise<OpenChamberProjectActionsState> {
  const setup = await readProjectSetup(project);
  return { actions: setup.projectActions, primaryActionId: setup.projectActionsPrimaryId };
}

export async function saveProjectActionsState(
  project: ProjectRef,
  value: OpenChamberProjectActionsState,
): Promise<boolean> {
  return updateProjectSetup(project, {
    projectActions: value.actions,
    projectActionsPrimaryId: value.primaryActionId,
  });
}

/**
 * Substitute variables in a command string.
 * Supported variables:
 * - $ROOT_PROJECT_PATH: The root project directory path
 * - $ROOT_WORKTREE_PATH: Legacy alias for $ROOT_PROJECT_PATH
 */
export function substituteCommandVariables(
  command: string,
  variables: { rootWorktreePath: string }
): string {
  return command
    // New preferred name
    .replace(/\$ROOT_PROJECT_PATH/g, variables.rootWorktreePath)
    .replace(/\$\{ROOT_PROJECT_PATH\}/g, variables.rootWorktreePath)
    // Legacy
    .replace(/\$ROOT_WORKTREE_PATH/g, variables.rootWorktreePath)
    .replace(/\$\{ROOT_WORKTREE_PATH\}/g, variables.rootWorktreePath);
}

export type { ProjectRef };
