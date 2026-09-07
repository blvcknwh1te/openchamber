import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ProjectSetupValidationError,
  projectSetupPatchToStored,
  projectSetupViewOf,
  sanitizeDraftStarters,
  sanitizeProjectActions,
  sanitizeSetupCommands,
} from './project-setup';
import { createProjectSetupStore, handleProjectSetupBridgeMessage } from './bridge-project-setup-runtime';

describe('project setup sanitizers', () => {
  test('keeps only non-empty trimmed setup commands', () => {
    assert.deepEqual(sanitizeSetupCommands([' bun install ', '', 42, '\n']), ['bun install']);
    assert.deepEqual(sanitizeSetupCommands('bun install'), []);
  });

  test('drops incomplete actions and duplicate ids, keeps only set optional fields', () => {
    assert.deepEqual(sanitizeProjectActions([
      { id: 'a', name: 'Dev', command: 'bun run dev', runIn: 'parent', platforms: ['macos', 'plan9'], icon: '' },
      { id: 'a', name: 'Again', command: 'x' },
      { id: '', name: 'No id', command: 'x' },
      { id: 'b', name: 'B', command: 'x', runIn: 'worktree' },
    ]), [
      { id: 'a', name: 'Dev', command: 'bun run dev', icon: null, platforms: ['macos'], runIn: 'parent' },
      { id: 'b', name: 'B', command: 'x', icon: null },
    ]);
  });

  test('dedupes draft starters by type and name', () => {
    assert.deepEqual(sanitizeDraftStarters([
      { type: 'skill', name: 'triage-prs' },
      { type: 'skill', name: 'triage-prs' },
      { type: 'agent', name: 'nope' },
    ]), [{ type: 'skill', name: 'triage-prs' }]);
  });

  test('builds the view from on-disk keys and nulls a dangling primary action', () => {
    assert.deepEqual(projectSetupViewOf({
      'setup-worktree': ['bun install'],
      'setup-worktree-wait': true,
      projectActions: [{ id: 'a', name: 'A', command: 'x' }],
      projectActionsPrimaryId: 'missing',
    }), {
      setupWorktree: ['bun install'],
      setupWorktreeWait: true,
      projectActions: [{ id: 'a', name: 'A', command: 'x', icon: null }],
      projectActionsPrimaryId: null,
      draftStarters: [],
    });
  });

  test('rejects wrongly shaped patch keys', () => {
    assert.throws(() => projectSetupPatchToStored({ setupWorktree: 'x' }), ProjectSetupValidationError);
    assert.throws(() => projectSetupPatchToStored(null), ProjectSetupValidationError);
    assert.deepEqual(projectSetupPatchToStored({ projectActionsPrimaryId: null }), { projectActionsPrimaryId: undefined });
  });
});

describe('project setup bridge', () => {
  const withStore = async (run: (store: ReturnType<typeof createProjectSetupStore>, dir: string) => Promise<void>) => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'oc-vscode-project-setup-'));
    try {
      await run(createProjectSetupStore(dir), dir);
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  };

  test('round-trips a patch through the bridge and preserves foreign keys', async () => {
    await withStore(async (store, dir) => {
      await fs.promises.writeFile(path.join(dir, 'project-a.json'), JSON.stringify({
        version: 1,
        scheduledTasks: [{ id: 'keep' }],
        'setup-worktree': ['old'],
      }));

      const updated = await handleProjectSetupBridgeMessage(
        { id: '1', type: 'api:project-setup:update', payload: { projectId: 'project-a', patch: { setupWorktree: ['bun install'], projectPath: '/repo' } } },
        store,
      );
      assert.equal(updated?.success, true);
      assert.deepEqual(updated?.data, {
        setupWorktree: ['bun install'],
        setupWorktreeWait: false,
        projectActions: [],
        projectActionsPrimaryId: null,
        draftStarters: [],
      });

      const raw = JSON.parse(await fs.promises.readFile(path.join(dir, 'project-a.json'), 'utf8'));
      assert.deepEqual(raw.scheduledTasks, [{ id: 'keep' }]);
      assert.equal(raw.projectPath, '/repo');

      const read = await handleProjectSetupBridgeMessage({ id: '2', type: 'api:project-setup:get', payload: { projectId: 'project-a' } }, store);
      assert.deepEqual(read?.data, updated?.data);
    });
  });

  test('answers a bad patch or project id with a failure, and ignores other messages', async () => {
    await withStore(async (store) => {
      const bad = await handleProjectSetupBridgeMessage(
        { id: '1', type: 'api:project-setup:update', payload: { projectId: 'project-a', patch: { setupWorktree: 'x' } } },
        store,
      );
      assert.equal(bad?.success, false);
      assert.match(bad?.error ?? '', /setupWorktree must be/);

      const badId = await handleProjectSetupBridgeMessage({ id: '2', type: 'api:project-setup:get', payload: { projectId: '../etc' } }, store);
      assert.equal(badId?.success, false);

      assert.equal(await handleProjectSetupBridgeMessage({ id: '3', type: 'api:fs:read', payload: {} }, store), null);
    });
  });

  test('serializes two quick updates to one file', async () => {
    await withStore(async (store, dir) => {
      await Promise.all([
        store.update('project-a', { setupWorktree: ['a'] }),
        store.update('project-a', { draftStarters: [{ type: 'skill', name: 's' }] }),
      ]);
      const raw = JSON.parse(await fs.promises.readFile(path.join(dir, 'project-a.json'), 'utf8'));
      assert.deepEqual(raw['setup-worktree'], ['a']);
      assert.deepEqual(raw.draftStarters, [{ type: 'skill', name: 's' }]);
    });
  });
});
