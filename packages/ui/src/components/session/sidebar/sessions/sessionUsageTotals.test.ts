import { beforeEach, describe, expect, test } from 'bun:test';
import type { Session } from '@opencode-ai/sdk/v2';

import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import type { SessionNode } from '../types';
import {
  reconcileSessionUsageTotals,
  resolveSessionNodeUsageTotals,
  sessionOwnUsageTotals,
  useSessionUsageTotalsStore,
} from './sessionUsageTotals';

type SessionUsageFixture = {
  cost?: number;
  tokens?: Session['tokens'];
};

const buildSession = (id: string, usage: SessionUsageFixture = {}): Session => {
  const session: Session = {
    id,
    slug: id,
    projectID: 'project-1',
    directory: '/repo',
    title: id,
    version: '1.0.0',
    time: { created: 1, updated: 2 },
  };
  if (usage.cost !== undefined) session.cost = usage.cost;
  if (usage.tokens !== undefined) session.tokens = usage.tokens;
  return session;
};

const buildNode = (session: Session, children: SessionNode[] = []): SessionNode => ({
  session,
  children,
  worktree: null,
});

const publishEntities = (sessions: Session[]): void => {
  useGlobalSessionsStore.setState({
    entityById: new Map(sessions.map((session) => [session.id, session])),
  });
};

beforeEach(() => {
  useSessionUsageTotalsStore.setState({ usageById: new Map() });
  useGlobalSessionsStore.setState({ entityById: new Map() });
});

describe('sessionOwnUsageTotals', () => {
  test('sums every token bucket and the session-wide cost', () => {
    expect(sessionOwnUsageTotals(buildSession('s1', {
      cost: 1.25,
      tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 100, write: 3 } },
    }))).toEqual({ cost: 1.25, tokens: 120 });
  });

  test('reports no usage for a session that never ran', () => {
    expect(sessionOwnUsageTotals(buildSession('s1'))).toEqual({ cost: 0, tokens: 0 });
    expect(sessionOwnUsageTotals(buildSession('s1', {
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    }))).toEqual({ cost: 0, tokens: 0 });
  });

  test('reads malformed or negative numbers as no usage instead of trusting them', () => {
    expect(sessionOwnUsageTotals(buildSession('s1', {
      cost: Number.NaN,
      tokens: { input: -5, output: Number.POSITIVE_INFINITY, reasoning: 3, cache: { read: 0, write: 0 } },
    }))).toEqual({ cost: 0, tokens: 3 });
    expect(sessionOwnUsageTotals(null)).toEqual({ cost: 0, tokens: 0 });
  });
});

describe('reconcileSessionUsageTotals', () => {
  test('reports no change when the cache projects to the same index', () => {
    const current = reconcileSessionUsageTotals(
      new Map(),
      new Map([['session-a', buildSession('session-a', { cost: 2, tokens: { input: 10, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } })]]),
    );
    const unchanged = reconcileSessionUsageTotals(
      current ?? new Map(),
      new Map([['session-a', buildSession('session-a', { cost: 2, tokens: { input: 10, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } })]]),
    );

    expect(unchanged).toBe(null);
  });

  test('adds, updates, and removes entries while keeping unaffected references', () => {
    const first = reconcileSessionUsageTotals(
      new Map(),
      new Map([
        ['session-a', buildSession('session-a', { cost: 1, tokens: { input: 1, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } })],
        ['session-b', buildSession('session-b', { cost: 2, tokens: { input: 2, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } })],
      ]),
    );
    const sessionB = first?.get('session-b');

    const second = reconcileSessionUsageTotals(
      first ?? new Map(),
      new Map([
        ['session-a', buildSession('session-a', { cost: 9, tokens: { input: 1, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } })],
        ['session-b', buildSession('session-b', { cost: 2, tokens: { input: 2, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } })],
        ['session-c', buildSession('session-c', { cost: 3, tokens: { input: 3, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } })],
      ]),
    );

    expect(second).not.toBe(null);
    expect(second?.get('session-a')).toEqual({ cost: 9, tokens: 1 });
    expect(second?.get('session-b')).toBe(sessionB);
    expect(second?.has('session-c')).toBe(true);

    const third = reconcileSessionUsageTotals(
      second ?? new Map(),
      new Map([['session-c', buildSession('session-c', { cost: 3, tokens: { input: 3, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } })]]),
    );

    expect([...(third?.keys() ?? [])]).toEqual(['session-c']);
  });

  test('drops an entry whose totals are gone instead of storing a zero total', () => {
    const current = reconcileSessionUsageTotals(
      new Map(),
      new Map([['session-a', buildSession('session-a', { cost: 4, tokens: { input: 4, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } })]]),
    );
    const next = reconcileSessionUsageTotals(
      current ?? new Map(),
      new Map([['session-a', buildSession('session-a')]]),
    );

    expect(next).not.toBe(null);
    expect(next?.size).toBe(0);
  });
});

describe('resolveSessionNodeUsageTotals', () => {
  test('adds the whole subtree, sub-sessions included', () => {
    const grandchild = buildNode(buildSession('grandchild', {
      cost: 0.5,
      tokens: { input: 5, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    }));
    const child = buildNode(buildSession('child', {
      cost: 1,
      tokens: { input: 10, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    }), [grandchild]);
    const root = buildNode(buildSession('root', {
      cost: 2,
      tokens: { input: 20, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    }), [child]);

    const totals = resolveSessionNodeUsageTotals(root, new Map());
    expect(totals).toEqual({ cost: 3.5, tokens: 35 });
  });

  test('prefers the index total over the stale session record the node carries', () => {
    const staleRoot = buildSession('root', {
      cost: 1.25,
      tokens: { input: 100, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    });
    const child = buildSession('child', {
      cost: 2.13,
      tokens: { input: 200, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    });
    const root = buildNode(staleRoot, [buildNode(child)]);
    const usageById = new Map([
      ['root', { cost: 1.25, tokens: 100 }],
      ['child', { cost: 2.13, tokens: 200 }],
    ]);

    expect(resolveSessionNodeUsageTotals(root, usageById)).toEqual({ cost: 3.38, tokens: 300 });
  });

  test('falls back to the node for a session the cache does not carry yet', () => {
    const liveChild = buildSession('live-child', {
      cost: 0.75,
      tokens: { input: 30, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    });
    const root = buildNode(buildSession('root', {
      cost: 1,
      tokens: { input: 10, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    }), [buildNode(liveChild)]);

    const totals = resolveSessionNodeUsageTotals(root, new Map([['root', { cost: 1, tokens: 10 }]]));
    expect(totals).toEqual({ cost: 1.75, tokens: 40 });
  });

  test('stops at a node that links back into its own subtree', () => {
    const root = buildNode(buildSession('root', {
      cost: 1,
      tokens: { input: 1, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    }));
    const child = buildNode(buildSession('child', {
      cost: 2,
      tokens: { input: 2, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    }));
    root.children = [child];
    child.children = [root];

    expect(resolveSessionNodeUsageTotals(root, new Map())).toEqual({ cost: 3, tokens: 3 });
  });
});

describe('session usage index wiring', () => {
  test('follows the global session cache as rows mount', () => {
    publishEntities([buildSession('session-a', {
      cost: 2,
      tokens: { input: 20, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    })]);

    expect(useSessionUsageTotalsStore.getState().usageById.get('session-a')).toEqual({ cost: 2, tokens: 20 });

    const entry = useSessionUsageTotalsStore.getState().usageById.get('session-a');
    publishEntities([
      buildSession('session-a', {
        cost: 2,
        tokens: { input: 20, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      }),
      buildSession('session-b', {
        cost: 3,
        tokens: { input: 30, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      }),
    ]);

    expect(useSessionUsageTotalsStore.getState().usageById.get('session-a')).toBe(entry);
    expect(useSessionUsageTotalsStore.getState().usageById.get('session-b')).toEqual({ cost: 3, tokens: 30 });
  });

  test('clears with the global cache when the runtime resets', () => {
    publishEntities([buildSession('session-a', {
      cost: 2,
      tokens: { input: 20, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    })]);
    expect(useSessionUsageTotalsStore.getState().usageById.size).toBe(1);

    publishEntities([]);

    expect(useSessionUsageTotalsStore.getState().usageById.size).toBe(0);
  });
});
