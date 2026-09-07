import { describe, expect, it } from 'vitest';
import os from 'os';
import path from 'path';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';

import { createProjectConfigRuntime } from './project-config.js';
import {
  projectSetupPatchToStored,
  projectSetupViewOf,
  sanitizeDraftStarters,
  sanitizeProjectActions,
  sanitizeSetupCommands,
} from './project-setup.js';

const createRuntime = async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'oc-project-setup-'));
  const runtime = createProjectConfigRuntime({
    fsPromises: await import('fs/promises'),
    path,
    projectsDirPath: tempRoot,
    createTaskID: () => 'task-fixed-id',
  });
  return {
    runtime,
    tempRoot,
    readRaw: async (projectId) => JSON.parse(await readFile(path.join(tempRoot, `${projectId}.json`), 'utf8')),
    cleanup: () => rm(tempRoot, { recursive: true, force: true }),
  };
};

describe('project setup sanitizers', () => {
  it('keeps only non-empty trimmed setup commands', () => {
    expect(sanitizeSetupCommands([' bun install ', '', 42, '\n'])).toEqual(['bun install']);
    expect(sanitizeSetupCommands('bun install')).toEqual([]);
  });

  it('drops actions without id, name, or command and duplicate ids', () => {
    expect(sanitizeProjectActions([
      { id: 'a', name: 'Dev', command: 'bun run dev' },
      { id: 'a', name: 'Again', command: 'x' },
      { id: '', name: 'No id', command: 'x' },
      { id: 'b', name: '', command: 'x' },
      'not an action',
    ])).toEqual([{ id: 'a', name: 'Dev', command: 'bun run dev', icon: null }]);
  });

  it('keeps only the optional action fields the user set', () => {
    expect(sanitizeProjectActions([{
      id: 'a',
      name: 'Dev',
      command: 'bun run dev',
      icon: ' rocket ',
      runIn: 'parent',
      platforms: ['macos', 'MacOS', 'plan9', 'linux'],
      autoOpenUrl: true,
      openUrl: 'http://localhost:3000',
      desktopOpenSshForward: '',
    }])).toEqual([{
      id: 'a',
      name: 'Dev',
      command: 'bun run dev',
      icon: 'rocket',
      autoOpenUrl: true,
      openUrl: 'http://localhost:3000',
      platforms: ['macos', 'linux'],
      runIn: 'parent',
    }]);
  });

  it('treats any runIn other than parent as the worktree default', () => {
    const [worktree, number] = sanitizeProjectActions([
      { id: 'a', name: 'A', command: 'x', runIn: 'worktree' },
      { id: 'b', name: 'B', command: 'x', runIn: 123 },
    ]);
    expect(worktree).not.toHaveProperty('runIn');
    expect(number).not.toHaveProperty('runIn');
  });

  it('dedupes draft starters by type and name', () => {
    expect(sanitizeDraftStarters([
      { type: 'skill', name: 'triage-prs' },
      { type: 'skill', name: 'triage-prs' },
      { type: 'command', name: ' explore ' },
      { type: 'agent', name: 'nope' },
    ])).toEqual([{ type: 'skill', name: 'triage-prs' }, { type: 'command', name: 'explore' }]);
  });

  it('builds the view from the on-disk keys and nulls a dangling primary action', () => {
    expect(projectSetupViewOf({
      'setup-worktree': ['bun install'],
      'setup-worktree-wait': true,
      projectActions: [{ id: 'a', name: 'A', command: 'x' }],
      projectActionsPrimaryId: 'missing',
      draftStarters: [{ type: 'skill', name: 's' }],
      scheduledTasks: [{ id: 't' }],
    })).toEqual({
      setupWorktree: ['bun install'],
      setupWorktreeWait: true,
      projectActions: [{ id: 'a', name: 'A', command: 'x', icon: null }],
      projectActionsPrimaryId: null,
      draftStarters: [{ type: 'skill', name: 's' }],
    });
    expect(projectSetupViewOf(null)).toEqual({
      setupWorktree: [],
      setupWorktreeWait: false,
      projectActions: [],
      projectActionsPrimaryId: null,
      draftStarters: [],
    });
  });

  it('maps a patch to the stored keys it names and rejects wrong shapes', () => {
    expect(projectSetupPatchToStored({ setupWorktree: ['a'], projectActionsPrimaryId: null })).toEqual({
      'setup-worktree': ['a'],
      projectActionsPrimaryId: undefined,
    });
    expect(projectSetupPatchToStored({})).toEqual({});
    expect(() => projectSetupPatchToStored({ setupWorktree: 'a' })).toThrow('setupWorktree must be');
    expect(() => projectSetupPatchToStored({ setupWorktreeWait: 'yes' })).toThrow('setupWorktreeWait must be');
    expect(() => projectSetupPatchToStored({ projectActions: {} })).toThrow('projectActions must be');
    expect(() => projectSetupPatchToStored({ draftStarters: null })).toThrow('draftStarters must be');
    expect(() => projectSetupPatchToStored([])).toThrow('patch must be');
  });
});

describe('project setup runtime', () => {
  it('reads an empty view for a project without a file', async () => {
    const { runtime, cleanup } = await createRuntime();
    try {
      expect(await runtime.readProjectSetup('project-a')).toEqual({
        setupWorktree: [],
        setupWorktreeWait: false,
        projectActions: [],
        projectActionsPrimaryId: null,
        draftStarters: [],
      });
    } finally {
      await cleanup();
    }
  });

  it('round-trips a patch and preserves server-owned and unknown keys', async () => {
    const { runtime, tempRoot, readRaw, cleanup } = await createRuntime();
    try {
      await writeFile(path.join(tempRoot, 'project-a.json'), JSON.stringify({
        version: 1,
        scheduledTasks: [{ id: 'task', name: 'Keep me' }],
        futureKey: { from: 'a newer build' },
        'setup-worktree': ['old'],
      }));

      const view = await runtime.updateProjectSetup('project-a', {
        setupWorktree: ['bun install', ''],
        projectActions: [{ id: 'dev', name: 'Dev', command: 'bun run dev' }],
        projectActionsPrimaryId: 'dev',
        projectPath: '/repo/a',
      });
      expect(view).toEqual({
        setupWorktree: ['bun install'],
        setupWorktreeWait: false,
        projectActions: [{ id: 'dev', name: 'Dev', command: 'bun run dev', icon: null }],
        projectActionsPrimaryId: 'dev',
        draftStarters: [],
      });

      const raw = await readRaw('project-a');
      expect(raw.scheduledTasks).toEqual([{ id: 'task', name: 'Keep me' }]);
      expect(raw.futureKey).toEqual({ from: 'a newer build' });
      expect(raw['setup-worktree']).toEqual(['bun install']);
      expect(raw.projectPath).toBe('/repo/a');
      expect(await runtime.readProjectSetup('project-a')).toEqual(view);
    } finally {
      await cleanup();
    }
  });

  it('clears the primary action id when the patch sets it to null', async () => {
    const { runtime, readRaw, cleanup } = await createRuntime();
    try {
      await runtime.updateProjectSetup('project-a', {
        projectActions: [{ id: 'dev', name: 'Dev', command: 'x' }],
        projectActionsPrimaryId: 'dev',
      });
      await runtime.updateProjectSetup('project-a', { projectActionsPrimaryId: null });
      expect(await readRaw('project-a')).not.toHaveProperty('projectActionsPrimaryId');
      expect((await runtime.readProjectSetup('project-a')).projectActionsPrimaryId).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it('leaves the file alone when the patch is invalid', async () => {
    const { runtime, tempRoot, cleanup } = await createRuntime();
    try {
      await expect(runtime.updateProjectSetup('project-a', { setupWorktree: 'nope' })).rejects.toThrow('setupWorktree must be');
      await expect(readFile(path.join(tempRoot, 'project-a.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await cleanup();
    }
  });

  it('does not clobber a scheduled task written between read and write', async () => {
    const { runtime, readRaw, cleanup } = await createRuntime();
    try {
      await runtime.upsertScheduledTask('project-a', {
        name: 'Nightly',
        enabled: true,
        schedule: { kind: 'daily', time: '09:30', timezone: 'UTC' },
        execution: { prompt: 'hi', providerID: 'openai', modelID: 'gpt' },
      });
      await Promise.all([
        runtime.updateProjectSetup('project-a', { setupWorktree: ['bun install'] }),
        runtime.updateProjectSetup('project-a', { draftStarters: [{ type: 'skill', name: 's' }] }),
      ]);
      const raw = await readRaw('project-a');
      expect(raw.scheduledTasks).toHaveLength(1);
      expect(raw['setup-worktree']).toEqual(['bun install']);
      expect(raw.draftStarters).toEqual([{ type: 'skill', name: 's' }]);
    } finally {
      await cleanup();
    }
  });
});
