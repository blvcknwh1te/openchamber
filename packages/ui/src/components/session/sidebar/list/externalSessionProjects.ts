import type { Project } from '@opencode-ai/sdk/v2';
import type { ProjectEntry } from '@/lib/api/types';
import { createProjectIdFromPath } from '@/lib/projectId';
import { normalizePath } from '@/lib/pathNormalization';

/**
 * A project entry the sidebar renders. `external` marks an entry discovered in
 * the shared OpenCode database instead of the local project registry; the
 * sidebar keeps the flag so it can hide the section while that project has no
 * sessions and never treat it as the workspace-active project.
 */
export type SessionProjectDisplayEntry = ProjectEntry & { external?: boolean };

export type ExternalSessionProjectEntry = SessionProjectDisplayEntry & { external: true };

/** Directory key shared by every path comparison in the sidebar. */
export const sessionProjectDirectoryKey = (value: string | null | undefined): string | null =>
  normalizePath(value)?.toLowerCase() ?? null;

const projectLabelFromWorktree = (worktree: string): string => {
  const normalized = normalizePath(worktree);
  if (!normalized) return worktree;
  const trimmed = normalized.replace(/\/+$/, '');
  const segments = trimmed.split('/');
  const last = segments[segments.length - 1] ?? '';
  // A drive root or a bare "/" keeps its full path; a basename alone would be
  // empty or meaningless there.
  if (!last || /^[A-Za-z]:$/.test(last)) return trimmed;
  return last;
};

/**
 * Directories that own at least one session in the global cache. The sidebar
 * cannot build a section for a project it has no sessions for, and it must not
 * guess: an empty project list would otherwise create a section per database
 * row, including repositories the user never opens.
 */
export const buildSessionDirectoryKeys = (
  sessions: ReadonlyArray<{ directory?: string | null; project?: { worktree?: string | null } | null }>,
): Set<string> => {
  const directories = new Set<string>();
  for (const session of sessions) {
    const key = sessionProjectDirectoryKey(session.directory ?? session.project?.worktree);
    if (key) directories.add(key);
  }
  return directories;
};

/**
 * Projects present in the global OpenCode database but absent from the local
 * project registry (VS Code keeps that registry in sync with its workspace
 * folders, so all other projects would be invisible). Only projects that own at
 * least one session are returned, ordered by their worktree path for a stable
 * list.
 */
export const selectExternalSessionProjects = (
  registryProjects: ReadonlyArray<{ path: string }>,
  globalProjects: ReadonlyArray<Project>,
  sessionDirectoryKeys: ReadonlySet<string>,
): ExternalSessionProjectEntry[] => {
  const knownKeys = new Set<string>();
  for (const project of registryProjects) {
    const key = sessionProjectDirectoryKey(project.path);
    if (key) knownKeys.add(key);
  }

  const candidates = new Map<string, Project>();
  for (const project of globalProjects) {
    const worktree = normalizePath(project.worktree);
    if (!worktree) continue;
    const key = worktree.toLowerCase();
    if (knownKeys.has(key)) continue;
    if (!sessionDirectoryKeys.has(key)) continue;
    // The database can hold the same directory under more than one row; the
    // first row wins because the list is already sorted by id upstream.
    if (!candidates.has(key)) candidates.set(key, project);
  }

  return [...candidates.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, project]) => {
      const worktree = normalizePath(project.worktree) as string;
      return {
        id: createProjectIdFromPath(worktree),
        path: worktree,
        label: projectLabelFromWorktree(worktree),
        external: true as const,
      };
    });
};

/** The registry list first, then the discovered projects. */
export const mergeSessionProjects = (
  registryProjects: ReadonlyArray<SessionProjectDisplayEntry>,
  externalProjects: ReadonlyArray<SessionProjectDisplayEntry>,
): SessionProjectDisplayEntry[] => [...registryProjects, ...externalProjects];

/**
 * The project list the sidebar renders.
 *
 * Discovery is opt-in: web and desktop keep the registry as the single
 * authority. When nothing was discovered the registry array is returned as-is,
 * because the sidebar derives worktree topology and repo status from this list
 * and a fresh reference on every render would defeat those memos.
 */
export const resolveSessionProjects = (
  registryProjects: SessionProjectDisplayEntry[],
  globalProjects: ReadonlyArray<Project>,
  sessionDirectoryKeys: ReadonlySet<string>,
  enabled: boolean,
): SessionProjectDisplayEntry[] => {
  if (!enabled || globalProjects.length === 0 || sessionDirectoryKeys.size === 0) {
    return registryProjects;
  }
  const externalProjects = selectExternalSessionProjects(registryProjects, globalProjects, sessionDirectoryKeys);
  return externalProjects.length === 0
    ? registryProjects
    : mergeSessionProjects(registryProjects, externalProjects);
};

/** True when the section only exists because the sidebar discovered it. */
export const isExternalSessionProject = (project: { external?: boolean }): boolean =>
  project.external === true;
