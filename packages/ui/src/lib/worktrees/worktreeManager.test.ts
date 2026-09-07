import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { GitNetworkOperation, GitNetworkOperationPlan, GitWorktreeCreateResult, RemoveGitWorktreePayload, SourceControlBindingRead } from '@/lib/api/types';
import type { WorktreeMetadata } from '@/types/worktree';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { sessionStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  } } });
});
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

type WorktreeListEntry = {
  path?: string;
  branch?: string;
  head?: string;
  name?: string;
};

const listCalls: string[] = [];
const listResolvers: Array<(value: WorktreeListEntry[]) => void> = [];
const createPayloads: unknown[] = [];
const validatePayloads: unknown[] = [];
const createdWorktree = {
  head: 'abc123',
  name: 'feature',
  branch: 'feature',
  path: '/repo-feature',
  directoryCreated: true as const,
  bootstrapStatus: { status: 'pending' as const, error: null, updatedAt: 1 },
};
let createdWorktreeResult: GitWorktreeCreateResult = createdWorktree;
const bootstrapWatcherCalls: string[] = [];
const bootstrapWatcherOptions: Array<{ onReady?: () => void }> = [];
const removeCalls: Array<{ directory: string; payload: RemoveGitWorktreePayload }> = [];

const sessionState = {
  availableWorktreesByProject: new Map<string, WorktreeMetadata[]>(),
  availableWorktrees: [] as WorktreeMetadata[],
  worktreeMetadata: new Map<string, WorktreeMetadata>(),
};
const attachmentState = {
  attachments: new Map<string, { worktreeStatus: 'pending' | 'ready'; worktreeRoot: string }>(),
};

mock.module('@/lib/openchamberConfig', () => ({
  substituteCommandVariables: (command: string) => command,
}));

mock.module('@/lib/worktrees/worktreeBootstrap', () => ({
  clearWorktreeBootstrapState: mock(),
  markWorktreeBootstrapPending: mock(),
  setWorktreeBootstrapState: mock(),
  startWorktreeBootstrapWatcher: (directory: string, options?: { onReady?: () => void }) => {
    bootstrapWatcherCalls.push(directory);
    bootstrapWatcherOptions.push(options ?? {});
  },
}));

mock.module('@/sync/session-worktree-store', () => ({
  useSessionWorktreeStore: {
    setState: (patch: Partial<typeof attachmentState> | ((state: typeof attachmentState) => Partial<typeof attachmentState>)) => {
      const next = typeof patch === 'function' ? patch(attachmentState) : patch;
      Object.assign(attachmentState, next);
    },
  },
}));

mock.module('@/lib/worktrees/worktreeStatus', () => ({
  invalidateResolvedProjectRootCache: mock(),
  resolveProjectRoot: (directory: string) => Promise.resolve(directory),
}));

mock.module('@/sync/session-ui-store', () => ({
  useSessionUIStore: {
    getState: () => sessionState,
    setState: (patch: Partial<typeof sessionState> | ((state: typeof sessionState) => Partial<typeof sessionState>)) => {
      const next = typeof patch === 'function' ? patch(sessionState) : patch;
      Object.assign(sessionState, next);
    },
  },
}));

mock.module('@/lib/gitApi', () => ({
  deleteRemoteBranch: mock(),
  git: {
    worktree: {
      list: (directory: string) => {
        listCalls.push(directory);
        return new Promise<WorktreeListEntry[]>((resolve) => {
          listResolvers.push(resolve);
        });
      },
      create: mock((_directory: string, payload: unknown) => {
        createPayloads.push(payload);
        return Promise.resolve(createdWorktreeResult);
      }),
      validate: mock((_directory: string, payload: unknown) => {
        validatePayloads.push(payload);
        return Promise.resolve({ ok: true, errors: [] });
      }),
      remove: mock((directory: string, payload: RemoveGitWorktreePayload) => {
        removeCalls.push({ directory, payload });
        return Promise.resolve({ success: true });
      }),
    },
  },
}));

const {
  createWorktree,
  getLatestWorktreeMetadata,
  listProjectWorktrees,
  partitionWorktreesByRegisteredProject,
  removeProjectWorktree,
  validateWorktreeCreate,
  worktreeMapsEqual,
} = await import('./worktreeManager');

const waitForListCallCount = async (count: number): Promise<void> => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (listCalls.length >= count) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error(`Expected ${count} worktree list calls, got ${listCalls.length}`);
};

describe('worktreeManager list invalidation', () => {
  beforeEach(() => {
    listCalls.length = 0;
    listResolvers.length = 0;
    createPayloads.length = 0;
    validatePayloads.length = 0;
    bootstrapWatcherCalls.length = 0;
    bootstrapWatcherOptions.length = 0;
    removeCalls.length = 0;
    createdWorktreeResult = createdWorktree;
    sessionState.availableWorktreesByProject = new Map();
    sessionState.availableWorktrees = [];
    sessionState.worktreeMetadata = new Map();
    attachmentState.attachments = new Map();
  });

  test('retries an in-flight list when a worktree is created before it resolves', async () => {
    const project = { id: 'project-1', path: '/repo' };
    const listing = listProjectWorktrees(project);

    await waitForListCallCount(1);

    await createWorktree(project, {
      preferredName: 'feature',
      mode: 'new',
      branchName: 'feature',
      worktreeName: 'feature',
    });

    listResolvers[0]([]);
    await waitForListCallCount(2);
    listResolvers[1]([createdWorktree]);

    const result = await listing;

    expect(listCalls).toEqual(['/repo', '/repo']);
    expect(result.map((entry) => entry.path)).toEqual(['/repo-feature']);
  });

  test('marks fast-created worktrees pending until bootstrap settles', async () => {
    const metadata = await createWorktree({ id: 'project-1', path: '/repo' }, {
      preferredName: 'feature',
      mode: 'new',
      branchName: 'feature',
      worktreeName: 'feature',
      returnAfterDirectoryCreated: true,
    });

    expect(metadata.worktreeStatus).toBe('pending');
    expect(sessionState.availableWorktrees[0]?.worktreeStatus).toBe('pending');
    expect(bootstrapWatcherCalls).toEqual(['/repo-feature']);
  });

  test('treats legacy create responses without bootstrap state as fully ready', async () => {
    createdWorktreeResult = {
      head: '',
      name: 'legacy-feature',
      branch: 'legacy-feature',
      path: '/repo-legacy-feature',
    };

    const metadata = await createWorktree({ id: 'project-1', path: '/repo' }, {
      preferredName: 'legacy-feature',
      mode: 'new',
      branchName: 'legacy-feature',
      worktreeName: 'legacy-feature',
      returnAfterDirectoryCreated: true,
    });

    expect(metadata.worktreeStatus).toBe('ready');
    expect(bootstrapWatcherCalls).toEqual([]);
  });

  test('reconciles session attachments when bootstrap becomes ready', async () => {
    const metadata = await createWorktree({ id: 'project-1', path: '/repo' }, {
      preferredName: 'feature',
      mode: 'new',
      branchName: 'feature',
      worktreeName: 'feature',
      returnAfterDirectoryCreated: true,
    });
    sessionState.worktreeMetadata.set('session-1', metadata);
    attachmentState.attachments.set('session-1', {
      worktreeRoot: metadata.path,
      worktreeStatus: 'pending',
    });

    bootstrapWatcherOptions[0]?.onReady?.();

    expect(sessionState.worktreeMetadata.get('session-1')?.worktreeStatus).toBe('ready');
    expect(attachmentState.attachments.get('session-1')?.worktreeStatus).toBe('ready');
  });

  test('resolves ready metadata when bootstrap settles before the session is attached', async () => {
    const metadata = await createWorktree({ id: 'project-1', path: '/repo' }, {
      preferredName: 'feature',
      mode: 'new',
      branchName: 'feature',
      worktreeName: 'feature',
      returnAfterDirectoryCreated: true,
    });

    bootstrapWatcherOptions[0]?.onReady?.();

    expect(metadata.worktreeStatus).toBe('pending');
    expect(getLatestWorktreeMetadata(metadata).worktreeStatus).toBe('ready');
  });
});

describe('worktreeMapsEqual', () => {
  const wt = (
    path: string,
    branch: string,
    overrides: Partial<WorktreeMetadata> = {},
  ): WorktreeMetadata => ({
    path,
    branch,
    projectDirectory: '/repo',
    label: branch,
    ...overrides,
  });

  test('returns true for two empty maps', () => {
    const a = new Map<string, WorktreeMetadata[]>();
    const b = new Map<string, WorktreeMetadata[]>();
    expect(worktreeMapsEqual(a, b)).toBe(true);
  });

  test('returns true when paths and branches match in order', () => {
    const a = new Map([['/repo', [wt('/r/main', 'main'), wt('/r/feat', 'feat')]]]);
    const b = new Map([['/repo', [wt('/r/main', 'main'), wt('/r/feat', 'feat')]]]);
    expect(worktreeMapsEqual(a, b)).toBe(true);
  });

  test('returns false when same path has a different branch (external git checkout)', () => {
    const a = new Map([['/repo', [wt('/r/main', 'main')]]]);
    const b = new Map([['/repo', [wt('/r/main', 'develop')]]]);
    expect(worktreeMapsEqual(a, b)).toBe(false);
  });

  test('returns false when head state changes without a branch change', () => {
    const a = new Map([['/repo', [wt('/r/main', '', { headState: 'unborn' })]]]);
    const b = new Map([['/repo', [wt('/r/main', '', { headState: 'detached' })]]]);
    expect(worktreeMapsEqual(a, b)).toBe(false);
  });

  test('returns false when discovered display metadata changes', () => {
    const a = new Map([['/repo', [wt('/r/main', '', { name: 'old', label: 'old' })]]]);
    const b = new Map([['/repo', [wt('/r/main', '', { name: 'new', label: 'new' })]]]);
    expect(worktreeMapsEqual(a, b)).toBe(false);
  });

  test('returns false when paths differ', () => {
    const a = new Map([['/repo', [wt('/r/main', 'main')]]]);
    const b = new Map([['/repo', [wt('/r/other', 'main')]]]);
    expect(worktreeMapsEqual(a, b)).toBe(false);
  });

  test('returns false when per-project array lengths differ', () => {
    const a = new Map([['/repo', [wt('/r/main', 'main')]]]);
    const b = new Map([['/repo', [wt('/r/main', 'main'), wt('/r/feat', 'feat')]]]);
    expect(worktreeMapsEqual(a, b)).toBe(false);
  });

  test('returns false when number of project keys differ', () => {
    const a = new Map<string, WorktreeMetadata[]>([['/repo', [wt('/r/main', 'main')]]]);
    const b = new Map<string, WorktreeMetadata[]>([
      ['/repo', [wt('/r/main', 'main')]],
      ['/repo-2', [wt('/r2/main', 'main')]],
    ]);
    expect(worktreeMapsEqual(a, b)).toBe(false);
  });

  test('returns false when worktrees are reordered (positional compare)', () => {
    const a = new Map([['/repo', [wt('/r/main', 'main'), wt('/r/feat', 'feat')]]]);
    const b = new Map([['/repo', [wt('/r/feat', 'feat'), wt('/r/main', 'main')]]]);
    expect(worktreeMapsEqual(a, b)).toBe(false);
  });

  test('returns false when a non-first worktree differs (subset of entries)', () => {
    const a = new Map([
      ['/repo', [wt('/r/main', 'main'), wt('/r/feat', 'feat'), wt('/r/old', 'old')]],
    ]);
    const b = new Map([
      ['/repo', [wt('/r/main', 'main'), wt('/r/feat', 'feat'), wt('/r/old', 'new-branch')]],
    ]);
    expect(worktreeMapsEqual(a, b)).toBe(false);
  });
});

describe('partitionWorktreesByRegisteredProject', () => {
  const worktree = (path: string, projectDirectory = '/repo'): WorktreeMetadata => {
    const label = path.split('/').pop() ?? path;
    return { path, projectDirectory, branch: label, label };
  };

  test('assigns shared topology to the primary project and omits configured worktree projects', () => {
    const projects = [
      { path: '/repo' },
      { path: '/worktrees/alpha' },
      { path: '/worktrees/beta' },
    ];
    const topology = new Map<string, WorktreeMetadata[]>([
      ['/repo', [
        worktree('/worktrees/alpha'),
        worktree('/worktrees/beta'),
        worktree('/worktrees/loose'),
      ]],
      ['/worktrees/alpha', [
        worktree('/repo'),
        worktree('/worktrees/beta'),
        worktree('/worktrees/loose'),
      ]],
      ['/worktrees/beta', [
        worktree('/repo'),
        worktree('/worktrees/alpha'),
        worktree('/worktrees/loose'),
      ]],
    ]);

    const result = partitionWorktreesByRegisteredProject(projects, topology);

    expect([...result.keys()]).toEqual(['/repo']);
    expect(result.get('/repo')?.map((entry) => entry.path)).toEqual(['/worktrees/loose']);
  });

  test('uses the first configured checkout when the primary project is not configured', () => {
    const projects = [
      { path: '/worktrees/alpha' },
      { path: '/worktrees/beta' },
    ];
    const topology = new Map<string, WorktreeMetadata[]>([
      ['/worktrees/beta', [
        worktree('/repo'),
        worktree('/worktrees/alpha'),
        worktree('/worktrees/loose'),
      ]],
      ['/worktrees/alpha', [
        worktree('/repo'),
        worktree('/worktrees/beta'),
        worktree('/worktrees/loose'),
      ]],
    ]);

    const result = partitionWorktreesByRegisteredProject(projects, topology);

    expect([...result.keys()]).toEqual(['/worktrees/alpha']);
    expect(result.get('/worktrees/alpha')?.map((entry) => entry.path)).toEqual([
      '/repo',
      '/worktrees/loose',
    ]);
  });

  test('keeps primary ownership when topology comes from another configured checkout', () => {
    const projects = [
      { path: '/repo' },
      { path: '/worktrees/alpha' },
    ];
    const topology = new Map<string, WorktreeMetadata[]>([
      ['/worktrees/alpha', [
        worktree('/repo'),
        worktree('/worktrees/loose'),
      ]],
    ]);

    const result = partitionWorktreesByRegisteredProject(projects, topology);

    expect([...result.keys()]).toEqual(['/repo']);
    expect(result.get('/repo')?.map((entry) => entry.path)).toEqual(['/worktrees/loose']);
  });
});

describe('worktreeManager fork remote payload wiring', () => {
  beforeEach(() => {
    listCalls.length = 0;
    listResolvers.length = 0;
    createPayloads.length = 0;
    validatePayloads.length = 0;
    bootstrapWatcherCalls.length = 0;
    bootstrapWatcherOptions.length = 0;
    createdWorktreeResult = createdWorktree;
    sessionState.availableWorktreesByProject = new Map();
    sessionState.availableWorktrees = [];
    sessionState.worktreeMetadata = new Map();
    attachmentState.attachments = new Map();
  });

  test('validate and create forward only the exact change-request source request', async () => {
    const project = { id: 'project-1', path: '/repo' };
    const args = {
      mode: 'existing' as const,
      branchName: 'feature/login',
      worktreeName: 'pr-42',
      existingBranch: 'remotes/pr-alice/feature/login',
      changeRequestSource: {
        context: { provider: 'github' as const, instance: 'github.com', directory: '/repo', repositoryId: 'repo_one', accountId: 'account_one', bindingRevision: 2, primaryRemote: 'origin' },
        project: { id: 'acme/app', owner: 'acme', name: 'app' },
        number: 42,
        expectedHeadSha: '1111111111111111111111111111111111111111',
        requestedRemoteName: 'pr-alice',
      },
      expectedRevision: '1111111111111111111111111111111111111111',
    };

    const validation = await validateWorktreeCreate(project, args);
    expect(validation.ok).toBe(true);
    expect(validatePayloads).toHaveLength(1);
    expect(validatePayloads[0]).toEqual(args);

    await createWorktree(project, {
      ...args,
      returnAfterDirectoryCreated: true,
    });
    expect(createPayloads).toHaveLength(1);
    expect(createPayloads[0]).toEqual({ ...args, returnAfterDirectoryCreated: true });
  });
});

describe('worktreeManager remote deletion ordering', () => {
  const endpoint = { displayUrl: 'https://example.com/team/repo.git', fingerprint: 'a'.repeat(64) };
  const bindingRead: SourceControlBindingRead = {
    status: 'bound',
    repository: {
      repositoryId: 'repository-one', configRevision: 'config-one', bare: false,
      remotes: [{ name: 'origin', fetch: endpoint, push: endpoint }],
    },
    revision: 3,
    binding: {
      repositoryId: 'repository-one', revision: 3, state: 'bound', configRevision: 'config-one',
      providers: [], auxiliary: [],
      remotes: [{ name: 'origin', fetch: endpoint, push: endpoint, mode: 'managed', credentialId: 'credential-one', readiness: 'ready' }],
    },
  };
  const plan: GitNetworkOperationPlan = {
    operationId: 'operation-delete',
    runtimeIdentity: { id: 'runtime-one', platform: 'web' },
    transport: { mode: 'managed', verification: { status: 'verified', method: 'credential' } },
    target: {
      operation: 'delete-remote-branch', repositoryId: 'repository-one', bindingRevision: 3,
      configRevision: 'config-one', remote: { name: 'origin', endpoint },
      destinationRef: 'refs/heads/feature/delete-me',
    },
    completedSteps: [],
    state: 'planned',
  };

  beforeEach(() => {
    removeCalls.length = 0;
  });

  for (const state of ['failed', 'outcome-unknown'] as const) {
    test(`does not remove the local worktree after ${state} remote deletion`, async () => {
      const terminalOperation = (): GitNetworkOperation => state === 'failed'
        ? { ...plan, state, error: { code: 'TRANSPORT_FAILED', message: 'Remote deletion did not complete' } }
        : { ...plan, state, error: { code: 'OUTCOME_UNKNOWN', message: 'Remote deletion did not complete' } };
      await expect(removeProjectWorktree(
        { id: 'project-one', path: '/repo' },
        { path: '/repo-feature', branch: 'feature/delete-me', projectDirectory: '/repo', label: 'delete-me' },
        {
          deleteRemoteBranch: true,
          deleteLocalBranch: true,
          remoteName: 'origin',
          network: {
            sourceControl: { repositoryBinding: async () => bindingRead },
            git: {
              planNetworkOperation: async () => plan,
              executeNetworkOperation: async () => terminalOperation(),
              getNetworkOperation: async () => terminalOperation(),
            },
          },
        },
      )).rejects.toThrow('Remote deletion did not complete');

      expect(removeCalls).toEqual([]);
    });
  }
});
