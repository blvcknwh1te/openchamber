import { describe, expect, it } from 'vitest';
import crypto from 'crypto';
import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import { createProjectIdFromPath } from '../projects/project-id.js';
import { createSettingsRuntime } from './settings-runtime.js';

const createRuntime = async () => {
  const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'oc-settings-runtime-'));
  const settingsFilePath = path.join(tempRoot, 'settings.json');
  const runtime = createSettingsRuntime({
    fsPromises,
    path,
    crypto,
    SETTINGS_FILE_PATH: settingsFilePath,
    sanitizeProjects: (projects) => Array.isArray(projects) ? projects : [],
    sanitizeSettingsUpdate: (settings) => settings,
    mergePersistedSettings: (_current, changes) => changes,
    normalizeSettingsPaths: (settings) => ({ settings, changed: false }),
    normalizeStringArray: (values) => Array.isArray(values) ? values.filter((value) => typeof value === 'string') : [],
    formatSettingsResponse: (settings) => settings,
    resolveDirectoryCandidate: (value) => value,
    normalizeManagedRemoteTunnelHostname: (value) => value,
    normalizeManagedRemoteTunnelPresets: (value) => value,
    normalizeManagedRemoteTunnelPresetTokens: (value) => value,
    syncManagedRemoteTunnelConfigWithPresets: async () => {},
    upsertManagedRemoteTunnelToken: async () => {},
  });

  return {
    runtime,
    settingsFilePath,
    tempRoot,
    cleanup: async () => {
      await fsPromises.rm(tempRoot, { recursive: true, force: true });
    },
  };
};

describe('settings runtime', () => {
  it('uses OpenChamber themes when a new install has no theme preferences', async () => {
    const { runtime, cleanup } = await createRuntime();
    try {
      await expect(runtime.readSettingsFromDiskMigrated()).resolves.toMatchObject({
        lightThemeId: 'openchamber-light',
        darkThemeId: 'openchamber-dark',
      });
    } finally {
      await cleanup();
    }
  });

  it('preserves existing theme preferences during theme migration', async () => {
    const { runtime, settingsFilePath, cleanup } = await createRuntime();
    try {
      await fsPromises.writeFile(settingsFilePath, JSON.stringify({
        lightThemeId: 'flexoki-light',
        darkThemeId: 'flexoki-dark',
      }), 'utf8');

      await expect(runtime.readSettingsFromDiskMigrated()).resolves.toMatchObject({
        lightThemeId: 'flexoki-light',
        darkThemeId: 'flexoki-dark',
      });
    } finally {
      await cleanup();
    }
  });

  it('round-trips shared sidebar preferences through preferences.json', async () => {
    const { runtime, settingsFilePath, tempRoot, cleanup } = await createRuntime();
    const preferences = {
      sidebarProjectDisplayMode: 'single',
      sidebarSessionGroupingMode: 'flat',
      sidebarProjectSortOrder: 'date-added',
      sidebarShowRecentSection: false,
    };
    try {
      await runtime.persistSettings(preferences);

      await expect(runtime.readSettingsFromDisk()).resolves.toEqual(preferences);
      // Profile keys live in preferences.json; settings.json keeps only instance facts.
      await expect(fsPromises.readFile(settingsFilePath, 'utf8')).resolves.toBe('{}');
      const stored = JSON.parse(await fsPromises.readFile(path.join(tempRoot, 'preferences.json'), 'utf8'));
      expect(Object.fromEntries(Object.entries(stored.fields).map(([key, entry]) => [key, entry.value]))).toEqual(preferences);
    } finally {
      await cleanup();
    }
  });

  it.skipIf(process.platform === 'win32')('writes settings with restrictive directory and file permissions', async () => {
    const { runtime, settingsFilePath, tempRoot, cleanup } = await createRuntime();
    try {
      await runtime.writeSettingsToDisk({ desktopUiPassword: 'secret' });

      expect((await fsPromises.stat(tempRoot)).mode & 0o777).toBe(0o700);
      expect((await fsPromises.stat(settingsFilePath)).mode & 0o777).toBe(0o600);
    } finally {
      await cleanup();
    }
  });

  it('only remaps project plan paths within the migrated storage directory', async () => {
    const { runtime, settingsFilePath, tempRoot, cleanup } = await createRuntime();
    try {
      const projectPath = path.join(tempRoot, 'project');
      const oldProjectId = 'legacy-project-id';
      const newProjectId = createProjectIdFromPath(projectPath);
      const projectsRoot = path.join(path.dirname(settingsFilePath), 'projects');
      const oldStorageDir = path.join(projectsRoot, oldProjectId);
      const newStorageDir = path.join(projectsRoot, newProjectId);
      const siblingStorageDir = `${oldStorageDir}-sibling`;

      await fsPromises.mkdir(projectPath, { recursive: true });
      await fsPromises.mkdir(projectsRoot, { recursive: true });
      await fsPromises.writeFile(
        settingsFilePath,
        JSON.stringify({
          projects: [{ id: oldProjectId, path: projectPath, addedAt: 1, lastOpenedAt: 1 }],
          activeProjectId: oldProjectId,
        }, null, 2),
        'utf8',
      );
      await fsPromises.writeFile(
        path.join(projectsRoot, `${oldProjectId}.json`),
        JSON.stringify({
          projectPlanFiles: [
            { id: 'inside', path: path.join(oldStorageDir, 'plans', 'inside.md') },
            { id: 'sibling', path: path.join(siblingStorageDir, 'plans', 'outside.md') },
          ],
        }, null, 2),
        'utf8',
      );

      await runtime.readSettingsFromDiskMigrated();

      const migratedConfig = JSON.parse(await fsPromises.readFile(path.join(projectsRoot, `${newProjectId}.json`), 'utf8'));
      expect(migratedConfig.projectPlanFiles).toEqual([
        { id: 'inside', path: path.join(newStorageDir, 'plans', 'inside.md') },
        { id: 'sibling', path: path.join(siblingStorageDir, 'plans', 'outside.md') },
      ]);
    } finally {
      await cleanup();
    }
  });

  it.skipIf(process.platform !== 'win32')('falls back when Windows blocks atomic settings replacement', async () => {
    const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'oc-settings-runtime-'));
    const settingsFilePath = path.join(tempRoot, 'settings.json');
    const wrappedFs = {
      ...fsPromises,
      rename: async () => {
        const error = new Error('operation not permitted');
        error.code = 'EPERM';
        throw error;
      },
    };
    const runtime = createSettingsRuntime({
      fsPromises: wrappedFs,
      path,
      crypto,
      SETTINGS_FILE_PATH: settingsFilePath,
      sanitizeProjects: (projects) => Array.isArray(projects) ? projects : [],
      sanitizeSettingsUpdate: (settings) => settings,
      mergePersistedSettings: (_current, changes) => changes,
      normalizeSettingsPaths: (settings) => ({ settings, changed: false }),
      normalizeStringArray: (values) => Array.isArray(values) ? values.filter((value) => typeof value === 'string') : [],
      formatSettingsResponse: (settings) => settings,
      resolveDirectoryCandidate: (value) => value,
      normalizeManagedRemoteTunnelHostname: (value) => value,
      normalizeManagedRemoteTunnelPresets: (value) => value,
      normalizeManagedRemoteTunnelPresetTokens: (value) => value,
      syncManagedRemoteTunnelConfigWithPresets: async () => {},
      upsertManagedRemoteTunnelToken: async () => {},
    });

    try {
      await runtime.writeSettingsToDisk({ theme: 'dark' });

      await expect(fsPromises.readFile(settingsFilePath, 'utf8')).resolves.toBe(JSON.stringify({ theme: 'dark' }, null, 2));
    } finally {
      await fsPromises.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('cleans up orphaned settings.json.tmp files during startup migration', async () => {
    const { runtime, settingsFilePath, tempRoot, cleanup } = await createRuntime();
    try {
      const settingsDir = path.dirname(settingsFilePath);
      const orphan1 = path.join(settingsDir, 'settings.json.tmp-1234-11111-abc');
      const orphan2 = path.join(settingsDir, 'settings.json.tmp-5678-22222-def');
      const unrelated = path.join(settingsDir, 'other-file.json');

      await fsPromises.writeFile(orphan1, '{"broken": true}', 'utf8');
      await fsPromises.writeFile(orphan2, '{"broken": true}', 'utf8');
      await fsPromises.writeFile(unrelated, '{"keep": true}', 'utf8');
      await fsPromises.writeFile(settingsFilePath, '{"theme": "light"}', 'utf8');

      await runtime.readSettingsFromDiskMigrated();

      const files = await fsPromises.readdir(settingsDir);
      expect(files).toContain('settings.json');
      expect(files).toContain('other-file.json');
      expect(files).not.toContain('settings.json.tmp-1234-11111-abc');
      expect(files).not.toContain('settings.json.tmp-5678-22222-def');
    } finally {
      await cleanup();
    }
  });

  it('removes temp file when writeSettingsToDisk encounters a write error', async () => {
    const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'oc-settings-runtime-'));
    const settingsFilePath = path.join(tempRoot, 'settings.json');
    let capturedTmp = null;
    const wrappedFs = {
      ...fsPromises,
      rename: async (src, dst) => {
        capturedTmp = src;
        const error = new Error('unexpected disk failure');
        error.code = 'EIO';
        throw error;
      },
    };
    const runtime = createSettingsRuntime({
      fsPromises: wrappedFs,
      path,
      crypto,
      SETTINGS_FILE_PATH: settingsFilePath,
      sanitizeProjects: (projects) => Array.isArray(projects) ? projects : [],
      sanitizeSettingsUpdate: (settings) => settings,
      mergePersistedSettings: (_current, changes) => changes,
      normalizeSettingsPaths: (settings) => ({ settings, changed: false }),
      normalizeStringArray: (values) => Array.isArray(values) ? values.filter((value) => typeof value === 'string') : [],
      formatSettingsResponse: (settings) => settings,
      resolveDirectoryCandidate: (value) => value,
      normalizeManagedRemoteTunnelHostname: (value) => value,
      normalizeManagedRemoteTunnelPresets: (value) => value,
      normalizeManagedRemoteTunnelPresetTokens: (value) => value,
      syncManagedRemoteTunnelConfigWithPresets: async () => {},
      upsertManagedRemoteTunnelToken: async () => {},
    });

    try {
      await expect(runtime.writeSettingsToDisk({ theme: 'dark' })).rejects.toThrow('unexpected disk failure');
      expect(capturedTmp).toBeTruthy();
      const files = await fsPromises.readdir(tempRoot);
      expect(files.some((f) => f.startsWith('settings.json.tmp-'))).toBe(false);
    } finally {
      await fsPromises.rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe('settings runtime: preferences.json split', () => {
  const readJson = async (filePath) => JSON.parse(await fsPromises.readFile(filePath, 'utf8'));

  it('seeds preferences.json from the profile keys of an existing settings.json and leaves that file intact', async () => {
    const { runtime, settingsFilePath, tempRoot, cleanup } = await createRuntime();
    try {
      const legacy = { projects: [], fontSize: 110, themeId: 'openchamber-dark', desktopLanAccessEnabled: true };
      await fsPromises.writeFile(settingsFilePath, JSON.stringify(legacy));

      const merged = await runtime.readSettingsFromDisk();
      expect(merged).toMatchObject(legacy);

      const preferences = await readJson(path.join(tempRoot, 'preferences.json'));
      expect(preferences.version).toBe(1);
      expect(Object.keys(preferences.fields).sort()).toEqual(['fontSize', 'themeId']);
      expect(preferences.fields.fontSize.value).toBe(110);
      expect(typeof preferences.fields.fontSize.updatedAt).toBe('number');
      expect(await readJson(settingsFilePath)).toEqual(legacy);
    } finally {
      await cleanup();
    }
  });

  it('routes profile keys to preferences.json, instance keys to settings.json, and drops device keys', async () => {
    const { runtime, settingsFilePath, tempRoot, cleanup } = await createRuntime();
    try {
      await runtime.persistSettings({ fontSize: 120, desktopLanAccessEnabled: true, mobileKeyboardMode: 'native' });

      const settings = await readJson(settingsFilePath);
      expect(settings.desktopLanAccessEnabled).toBe(true);
      expect(settings).not.toHaveProperty('fontSize');
      expect(settings).not.toHaveProperty('mobileKeyboardMode');

      const preferences = await readJson(path.join(tempRoot, 'preferences.json'));
      expect(preferences.fields.fontSize.value).toBe(120);
      expect(preferences.fields).not.toHaveProperty('mobileKeyboardMode');
      expect(preferences.fields).not.toHaveProperty('desktopLanAccessEnabled');

      expect(await runtime.readSettingsFromDisk()).toMatchObject({ fontSize: 120, desktopLanAccessEnabled: true });
    } finally {
      await cleanup();
    }
  });

  it('keeps the timestamp of an unchanged profile key and restamps a changed one', async () => {
    const { runtime, tempRoot, cleanup } = await createRuntime();
    try {
      const preferencesPath = path.join(tempRoot, 'preferences.json');
      await runtime.persistSettings({ fontSize: 100, padding: 100 });
      const first = await readJson(preferencesPath);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await runtime.persistSettings({ fontSize: 100, padding: 120 });
      const second = await readJson(preferencesPath);

      expect(second.fields.fontSize.updatedAt).toBe(first.fields.fontSize.updatedAt);
      expect(second.fields.padding.updatedAt).toBeGreaterThan(first.fields.padding.updatedAt);
      expect(second.fields.padding.value).toBe(120);
    } finally {
      await cleanup();
    }
  });

  it('treats an unreadable preferences.json as failure: no seed, no overwrite, profile writes refused, instance still served', async () => {
    const { runtime, settingsFilePath, tempRoot, cleanup } = await createRuntime();
    try {
      const preferencesPath = path.join(tempRoot, 'preferences.json');
      await fsPromises.writeFile(settingsFilePath, JSON.stringify({ desktopLanAccessEnabled: true }));
      await fsPromises.writeFile(preferencesPath, '{ not json');

      expect(await runtime.readSettingsFromDisk()).toEqual({ desktopLanAccessEnabled: true });

      await runtime.persistSettings({ fontSize: 130, desktopKeepAwakeEnabled: true });

      expect(await fsPromises.readFile(preferencesPath, 'utf8')).toBe('{ not json');
      const settings = await readJson(settingsFilePath);
      expect(settings.desktopKeepAwakeEnabled).toBe(true);
      expect(settings).not.toHaveProperty('fontSize');
    } finally {
      await cleanup();
    }
  });
});
