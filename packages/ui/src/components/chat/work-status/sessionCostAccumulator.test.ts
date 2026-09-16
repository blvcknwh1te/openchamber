import { beforeEach, describe, expect, test } from 'bun:test';
import type { Session } from '@opencode-ai/sdk/v2';
import {
  SESSION_COST_LEDGER_LIMIT,
  accumulateLiveSessionTotals,
  accumulateSessionTotals,
  resetSessionCostLedger,
} from './sessionCostAccumulator';

function makeSession(id: string, cost: number, tokens?: Session['tokens']): Session {
  return {
    id,
    slug: id,
    projectID: 'project',
    directory: '/project',
    title: id,
    version: '1',
    time: { created: 0, updated: 0 },
    cost,
    tokens,
  };
}

const tokens = (input: number, output: number, reasoning: number, read: number, write: number): Session['tokens'] => ({
  input,
  output,
  reasoning,
  cache: { read, write },
});

describe('sessionCostAccumulator', () => {
  beforeEach(() => {
    resetSessionCostLedger();
  });

  test('keeps the highest observed cost when a later snapshot reports less', () => {
    const runtimeKey = 'rt-a';
    const first = accumulateSessionTotals(runtimeKey, makeSession('root', 12.5));
    expect(first.cost).toBe(12.5);

    const afterModelSwitch = accumulateSessionTotals(runtimeKey, makeSession('root', 0));
    expect(afterModelSwitch.cost).toBe(12.5);
  });

  test('reports a new peak as soon as more spend arrives', () => {
    const runtimeKey = 'rt-a';
    accumulateSessionTotals(runtimeKey, makeSession('root', 12.5));
    accumulateSessionTotals(runtimeKey, makeSession('root', 1));

    const grown = accumulateSessionTotals(runtimeKey, makeSession('root', 14));
    expect(grown.cost).toBe(14);
  });

  test('accumulates every token field independently', () => {
    const runtimeKey = 'rt-a';
    accumulateSessionTotals(runtimeKey, makeSession('root', 1, tokens(100, 50, 10, 5, 2)));

    const merged = accumulateSessionTotals(runtimeKey, makeSession('root', 0, tokens(80, 60, 0, 3, 4)));
    expect(merged.tokens).toEqual({
      input: 100,
      output: 60,
      reasoning: 10,
      cache: { read: 5, write: 4 },
    });
  });

  test('keeps known tokens when a partial payload omits them', () => {
    const runtimeKey = 'rt-a';
    accumulateSessionTotals(runtimeKey, makeSession('root', 1, tokens(100, 50, 10, 5, 2)));

    const partial = accumulateSessionTotals(runtimeKey, makeSession('root', 1));
    expect(partial.tokens).toEqual(tokens(100, 50, 10, 5, 2));
  });

  test('returns the original session reference when nothing moves', () => {
    const runtimeKey = 'rt-a';
    const session = makeSession('root', 3, tokens(1, 2, 3, 4, 5));
    accumulateSessionTotals(runtimeKey, session);

    expect(accumulateSessionTotals(runtimeKey, session)).toBe(session);
    expect(accumulateSessionTotals(runtimeKey, makeSession('root', 2))).not.toBe(session);
  });

  test('keeps sessions independent of each other', () => {
    const runtimeKey = 'rt-a';
    accumulateSessionTotals(runtimeKey, makeSession('root', 10));
    accumulateSessionTotals(runtimeKey, makeSession('child', 4));

    expect(accumulateSessionTotals(runtimeKey, makeSession('root', 1)).cost).toBe(10);
    expect(accumulateSessionTotals(runtimeKey, makeSession('child', 2)).cost).toBe(4);
  });

  test('isolates the same session id across runtimes', () => {
    accumulateSessionTotals('rt-a', makeSession('root', 10));
    expect(accumulateSessionTotals('rt-b', makeSession('root', 1)).cost).toBe(1);
  });

  test('does not lower a session it has never seen before', () => {
    const fresh = accumulateSessionTotals('rt-a', makeSession('root', 0));
    expect(fresh.cost).toBe(0);
  });

  test('applies the ledger to a list and preserves the array when nothing moved', () => {
    const runtimeKey = 'rt-a';
    const sessions = [makeSession('root', 5), makeSession('child', 2)];

    expect(accumulateLiveSessionTotals(runtimeKey, sessions)).toBe(sessions);

    const dropped = accumulateLiveSessionTotals(runtimeKey, [makeSession('root', 1), makeSession('child', 0)]);
    expect(dropped.map((session) => session.cost)).toEqual([5, 2]);
    expect(dropped.map((session) => session.id)).toEqual(['root', 'child']);
  });

  test('bounds how many sessions it remembers', () => {
    const runtimeKey = 'rt-a';
    for (let index = 0; index <= SESSION_COST_LEDGER_LIMIT; index += 1) {
      accumulateSessionTotals(runtimeKey, makeSession(`session-${index}`, 100));
    }

    // The newest observation is still protected.
    const remembered = accumulateSessionTotals(runtimeKey, makeSession('session-1', 1));
    expect(remembered.cost).toBe(100);

    // The oldest observation was pruned, so its stale value can no longer hold
    // a later reading at the old high-water mark.
    const forgotten = accumulateSessionTotals(runtimeKey, makeSession('session-0', 1));
    expect(forgotten.cost).toBe(1);
  });
});
