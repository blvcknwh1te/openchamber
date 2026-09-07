// The client-owned part of a project's config file
// (`~/.config/openchamber/projects/<projectId>.json`): worktree setup
// commands, project actions, and pinned draft starters. A mirror of the
// server's `packages/web/server/lib/projects/project-setup.js`; keep the
// sanitizing rules in sync so a value written from VS Code reads back the
// same on every other surface.
//
// Kept free of `vscode` imports so it is unit-tested directly.

const ACTION_NAME_MAX_LENGTH = 80;
const ACTION_COMMAND_MAX_LENGTH = 4000;
const ACTION_OPEN_URL_MAX_LENGTH = 2000;
const ACTION_DESKTOP_FORWARD_MAX_LENGTH = 300;
const SETUP_COMMAND_MAX_LENGTH = 4000;
const SETUP_COMMANDS_MAX = 50;

type ActionPlatform = 'macos' | 'linux' | 'windows';
const ACTION_PLATFORMS: ReadonlySet<string> = new Set<ActionPlatform>(['macos', 'linux', 'windows']);

export type ProjectAction = {
  id: string;
  name: string;
  command: string;
  icon: string | null;
  autoOpenUrl?: true;
  openUrl?: string;
  desktopOpenSshForward?: string;
  platforms?: ActionPlatform[];
  runIn?: 'parent';
};

export type DraftStarter = { type: 'command' | 'skill'; name: string };

export type ProjectSetupView = {
  setupWorktree: string[];
  setupWorktreeWait: boolean;
  projectActions: ProjectAction[];
  projectActionsPrimaryId: string | null;
  draftStarters: DraftStarter[];
};

/**
 * The on-disk keys this module owns inside the project config document, as a
 * patch: a key set to `undefined` is removed from the document.
 */
export type StoredProjectSetupPatch = {
  'setup-worktree'?: string[];
  'setup-worktree-wait'?: boolean;
  projectActions?: ProjectAction[];
  projectActionsPrimaryId?: string | undefined;
  draftStarters?: DraftStarter[];
  projectPath?: string;
};

export class ProjectSetupValidationError extends Error {}

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const clamp = (value: string, maxLength: number): string => (value.length > maxLength ? value.slice(0, maxLength) : value);

const trimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export const sanitizeSetupCommands = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const commands: string[] = [];
  for (const entry of value) {
    const command = clamp(trimmedString(entry), SETUP_COMMAND_MAX_LENGTH);
    if (!command) continue;
    commands.push(command);
    if (commands.length >= SETUP_COMMANDS_MAX) break;
  }
  return commands;
};

const sanitizeActionPlatforms = (value: unknown): ActionPlatform[] => {
  if (!Array.isArray(value)) return [];
  const platforms: ActionPlatform[] = [];
  for (const entry of value) {
    const platform = trimmedString(entry).toLowerCase();
    if (!ACTION_PLATFORMS.has(platform)) continue;
    // SAFETY: membership in ACTION_PLATFORMS was just checked.
    const known = platform as ActionPlatform;
    if (!platforms.includes(known)) platforms.push(known);
  }
  return platforms;
};

export const sanitizeProjectActions = (value: unknown): ProjectAction[] => {
  if (!Array.isArray(value)) return [];
  const actions: ProjectAction[] = [];
  const seenIds = new Set<string>();
  for (const entry of value) {
    if (!isObjectRecord(entry)) continue;
    const id = trimmedString(entry.id);
    const name = clamp(trimmedString(entry.name), ACTION_NAME_MAX_LENGTH);
    const command = clamp(trimmedString(entry.command), ACTION_COMMAND_MAX_LENGTH);
    if (!id || !name || !command || seenIds.has(id)) continue;
    seenIds.add(id);

    const icon = trimmedString(entry.icon);
    const platforms = sanitizeActionPlatforms(entry.platforms);
    const openUrl = clamp(trimmedString(entry.openUrl), ACTION_OPEN_URL_MAX_LENGTH);
    const desktopOpenSshForward = clamp(trimmedString(entry.desktopOpenSshForward), ACTION_DESKTOP_FORWARD_MAX_LENGTH);

    const action: ProjectAction = { id, name, command, icon: icon || null };
    if (entry.autoOpenUrl === true) action.autoOpenUrl = true;
    if (openUrl) action.openUrl = openUrl;
    if (desktopOpenSshForward) action.desktopOpenSshForward = desktopOpenSshForward;
    if (platforms.length > 0) action.platforms = platforms;
    if (entry.runIn === 'parent') action.runIn = 'parent';
    actions.push(action);
  }
  return actions;
};

export const sanitizeDraftStarters = (value: unknown): DraftStarter[] => {
  if (!Array.isArray(value)) return [];
  const starters: DraftStarter[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isObjectRecord(entry)) continue;
    const type = entry.type === 'command' || entry.type === 'skill' ? entry.type : null;
    const name = trimmedString(entry.name);
    if (!type || !name) continue;
    const key = `${type}:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    starters.push({ type, name });
  }
  return starters;
};

export const projectSetupViewOf = (raw: unknown): ProjectSetupView => {
  const document = isObjectRecord(raw) ? raw : {};
  const projectActions = sanitizeProjectActions(document.projectActions);
  const primaryRaw = trimmedString(document.projectActionsPrimaryId);
  return {
    setupWorktree: sanitizeSetupCommands(document['setup-worktree']),
    setupWorktreeWait: document['setup-worktree-wait'] === true,
    projectActions,
    projectActionsPrimaryId: primaryRaw && projectActions.some((action) => action.id === primaryRaw) ? primaryRaw : null,
    draftStarters: sanitizeDraftStarters(document.draftStarters),
  };
};

/**
 * The stored keys a client patch changes; `undefined` marks a key to remove.
 * A key with the wrong shape is a validation error, never silently dropped.
 */
export const projectSetupPatchToStored = (patch: unknown): StoredProjectSetupPatch => {
  if (!isObjectRecord(patch)) {
    throw new ProjectSetupValidationError('patch must be an object');
  }
  const stored: StoredProjectSetupPatch = {};
  if ('setupWorktree' in patch) {
    if (!Array.isArray(patch.setupWorktree)) throw new ProjectSetupValidationError('setupWorktree must be an array of commands');
    stored['setup-worktree'] = sanitizeSetupCommands(patch.setupWorktree);
  }
  if ('setupWorktreeWait' in patch) {
    if (typeof patch.setupWorktreeWait !== 'boolean') throw new ProjectSetupValidationError('setupWorktreeWait must be a boolean');
    stored['setup-worktree-wait'] = patch.setupWorktreeWait;
  }
  if ('projectActions' in patch) {
    if (!Array.isArray(patch.projectActions)) throw new ProjectSetupValidationError('projectActions must be an array');
    stored.projectActions = sanitizeProjectActions(patch.projectActions);
  }
  if ('projectActionsPrimaryId' in patch) {
    const primary = patch.projectActionsPrimaryId;
    if (primary !== null && typeof primary !== 'string') {
      throw new ProjectSetupValidationError('projectActionsPrimaryId must be a string or null');
    }
    stored.projectActionsPrimaryId = trimmedString(primary) || undefined;
  }
  if ('draftStarters' in patch) {
    if (!Array.isArray(patch.draftStarters)) throw new ProjectSetupValidationError('draftStarters must be an array');
    stored.draftStarters = sanitizeDraftStarters(patch.draftStarters);
  }
  if ('projectPath' in patch) {
    if (typeof patch.projectPath !== 'string') throw new ProjectSetupValidationError('projectPath must be a string');
    const projectPath = patch.projectPath.trim();
    if (projectPath) stored.projectPath = projectPath;
  }
  return stored;
};
