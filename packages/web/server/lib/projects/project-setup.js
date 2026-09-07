// The client-owned part of a project's config file
// (`~/.config/openchamber/projects/<projectId>.json`): worktree setup commands,
// project actions, and pinned draft starters. This module is the one place
// that knows the on-disk keys and the shapes; the route and the VS Code bridge
// (`packages/vscode/src/project-setup.ts`, a mirror of this file) sanitize
// with the same rules so a value written from any surface reads back the same.
//
// Server-owned keys in the same file (`version`, `scheduledTasks`) are never
// touched here; `readRaw`/`writeRaw` callers preserve them.

const ACTION_NAME_MAX_LENGTH = 80;
const ACTION_COMMAND_MAX_LENGTH = 4000;
const ACTION_OPEN_URL_MAX_LENGTH = 2000;
const ACTION_DESKTOP_FORWARD_MAX_LENGTH = 300;
const SETUP_COMMAND_MAX_LENGTH = 4000;
const SETUP_COMMANDS_MAX = 50;

const ACTION_PLATFORMS = new Set(['macos', 'linux', 'windows']);

const isObjectRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const clamp = (value, maxLength) => (value.length > maxLength ? value.slice(0, maxLength) : value);

const trimmedString = (value) => (typeof value === 'string' ? value.trim() : '');

/** Setup commands: non-empty trimmed strings, capped in count and length. */
export const sanitizeSetupCommands = (value) => {
  if (!Array.isArray(value)) return [];
  const commands = [];
  for (const entry of value) {
    const command = clamp(trimmedString(entry), SETUP_COMMAND_MAX_LENGTH);
    if (!command) continue;
    commands.push(command);
    if (commands.length >= SETUP_COMMANDS_MAX) break;
  }
  return commands;
};

const sanitizeActionPlatforms = (value) => {
  if (!Array.isArray(value)) return [];
  const platforms = [];
  for (const entry of value) {
    const platform = trimmedString(entry).toLowerCase();
    if (ACTION_PLATFORMS.has(platform) && !platforms.includes(platform)) platforms.push(platform);
  }
  return platforms;
};

/**
 * Project actions: `id`, `name`, and `command` are required and ids are
 * unique; every optional field is dropped when empty so the stored record
 * carries only what the user set. `runIn` keeps only the one value the UI
 * understands (`parent`); anything else means "run in the worktree".
 */
export const sanitizeProjectActions = (value) => {
  if (!Array.isArray(value)) return [];
  const actions = [];
  const seenIds = new Set();
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

    const action = { id, name, command, icon: icon || null };
    if (entry.autoOpenUrl === true) action.autoOpenUrl = true;
    if (openUrl) action.openUrl = openUrl;
    if (desktopOpenSshForward) action.desktopOpenSshForward = desktopOpenSshForward;
    if (platforms.length > 0) action.platforms = platforms;
    if (entry.runIn === 'parent') action.runIn = 'parent';
    actions.push(action);
  }
  return actions;
};

/** Draft starters: `{ type: 'command' | 'skill', name }`, unique by `type:name`. */
export const sanitizeDraftStarters = (value) => {
  if (!Array.isArray(value)) return [];
  const starters = [];
  const seen = new Set();
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

/**
 * The client-facing view of a raw config document. A primary action id that
 * names no action is reported as `null`.
 */
export const projectSetupViewOf = (raw) => {
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
 * Turn a client patch (view keys) into the on-disk keys it changes. Only the
 * keys present in the patch are returned, so a caller can merge the result
 * over the raw document without clearing what the patch did not mention.
 * A key with the wrong shape is a validation error, never silently dropped.
 */
export const projectSetupPatchToStored = (patch) => {
  if (!isObjectRecord(patch)) {
    throw new Error('patch must be an object');
  }
  const stored = {};
  if ('setupWorktree' in patch) {
    if (!Array.isArray(patch.setupWorktree)) throw new Error('setupWorktree must be an array of commands');
    stored['setup-worktree'] = sanitizeSetupCommands(patch.setupWorktree);
  }
  if ('setupWorktreeWait' in patch) {
    if (typeof patch.setupWorktreeWait !== 'boolean') throw new Error('setupWorktreeWait must be a boolean');
    stored['setup-worktree-wait'] = patch.setupWorktreeWait;
  }
  if ('projectActions' in patch) {
    if (!Array.isArray(patch.projectActions)) throw new Error('projectActions must be an array');
    stored.projectActions = sanitizeProjectActions(patch.projectActions);
  }
  if ('projectActionsPrimaryId' in patch) {
    const primary = patch.projectActionsPrimaryId;
    if (primary !== null && typeof primary !== 'string') throw new Error('projectActionsPrimaryId must be a string or null');
    stored.projectActionsPrimaryId = trimmedString(primary) || undefined;
  }
  if ('draftStarters' in patch) {
    if (!Array.isArray(patch.draftStarters)) throw new Error('draftStarters must be an array');
    stored.draftStarters = sanitizeDraftStarters(patch.draftStarters);
  }
  if ('projectPath' in patch) {
    if (typeof patch.projectPath !== 'string') throw new Error('projectPath must be a string');
    const projectPath = patch.projectPath.trim();
    if (projectPath) stored.projectPath = projectPath;
  }
  return stored;
};

export const isProjectSetupValidationError = (error) => {
  const message = error instanceof Error ? error.message : '';
  return message.includes('must be') || message.includes('is required') || message.includes('unsupported characters');
};
