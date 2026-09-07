import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { createProjectIdFromPath } from './projectId';

const project = { id: 'openchamber', path: '/workspace/openchamber' };
const endpoint = `/api/projects/${encodeURIComponent(createProjectIdFromPath(project.path))}/config`;

const emptySetup = {
  setupWorktree: [],
  setupWorktreeWait: false,
  projectActions: [],
  projectActionsPrimaryId: null,
  draftStarters: [],
};

// A minimal stand-in for the server: one document per project, the PUT
// merges the patch and echoes the view back like the real route.
let stored: Record<string, unknown> = { ...emptySetup };
let requests: Array<{ url: string; method: string; body: unknown }> = [];
let failWith: number | null = null;

mock.module('@/lib/runtime-fetch', () => ({
  runtimeFetch: mock(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    requests.push({ url, method, body });
    if (failWith !== null) {
      return new Response(JSON.stringify({ error: 'nope' }), { status: failWith });
    }
    if (method === 'PUT') {
      const { projectPath: _projectPath, ...patch } = body as Record<string, unknown>;
      stored = { ...stored, ...patch };
    }
    return new Response(JSON.stringify(stored), { headers: { 'Content-Type': 'application/json' } });
  }),
}));

const {
  getProjectActionsState,
  getProjectDraftStarters,
  getWorktreeSetupCommands,
  getWorktreeSetupWaitEnabled,
  saveProjectActionsState,
  saveWorktreeSetupCommands,
} = await import('./openchamberConfig');

describe('project config client', () => {
  beforeEach(() => {
    stored = { ...emptySetup };
    requests = [];
    failWith = null;
  });

  test('reads and writes through the project config route, never a file path', async () => {
    const saved = await saveProjectActionsState(project, {
      actions: [{ id: 'action-1', name: 'Run action', command: 'pnpm dev', runIn: 'parent' }],
      primaryActionId: 'action-1',
    });
    expect(saved).toBe(true);
    expect(requests[0]).toEqual({
      url: endpoint,
      method: 'PUT',
      body: {
        projectActions: [{ id: 'action-1', name: 'Run action', command: 'pnpm dev', runIn: 'parent' }],
        projectActionsPrimaryId: 'action-1',
        projectPath: project.path,
      },
    });

    const state = await getProjectActionsState(project);
    expect(state).toEqual({
      actions: [{ id: 'action-1', name: 'Run action', command: 'pnpm dev', runIn: 'parent' }],
      primaryActionId: 'action-1',
    });
    expect(requests[1]).toEqual({ url: endpoint, method: 'GET', body: null });
  });

  test('drops empty setup commands before sending', async () => {
    await saveWorktreeSetupCommands(project, ['bun install', '', '  ']);
    expect(requests[0].body).toEqual({ setupWorktree: ['bun install'], projectPath: project.path });
    expect(await getWorktreeSetupCommands(project)).toEqual(['bun install']);
  });

  test('parses draft starters defensively from the response', async () => {
    stored = { ...emptySetup, draftStarters: [{ type: 'skill', name: 'triage-prs' }, { type: 'bogus', name: 'x' }] };
    expect(await getProjectDraftStarters(project)).toEqual([{ type: 'skill', name: 'triage-prs' }]);
  });

  test('a failed read resolves to the empty value and a failed write to false', async () => {
    failWith = 500;
    expect(await getWorktreeSetupCommands(project)).toEqual([]);
    expect(await getWorktreeSetupWaitEnabled(project)).toBe(false);
    expect(await getProjectActionsState(project)).toEqual({ actions: [], primaryActionId: null });
    expect(await saveWorktreeSetupCommands(project, ['x'])).toBe(false);
  });

  test('a response with an unexpected shape is not trusted', async () => {
    stored = { setupWorktree: 'bun install' };
    expect(await getWorktreeSetupCommands(project)).toEqual([]);
  });

  test('a project without a path never hits the network', async () => {
    expect(await getWorktreeSetupCommands({ id: 'x', path: '' })).toEqual([]);
    expect(await saveWorktreeSetupCommands({ id: 'x', path: '' }, ['x'])).toBe(false);
    expect(requests).toHaveLength(0);
  });
});
