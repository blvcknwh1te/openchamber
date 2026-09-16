import React from 'react';
import type { Session } from '@opencode-ai/sdk/v2';
import { useAllLiveSessions, useSyncRuntime } from '@/sync/sync-context';
import { buildChildrenIndex, computeSubtreeCost } from './subagentCost';
import { accumulateLiveSessionTotals } from './sessionCostAccumulator';

export type SubagentCostRollup = {
  totalCost: number | null;
  /** The root session's own spend, excluding every subagent. */
  ownCost: number;
  /** Everything the subagents cost between them: `totalCost - ownCost`. */
  subagentCost: number;
  subagentCount: number;
  perChildCost: Map<string, number>;
};

const EMPTY_ROLLUP: SubagentCostRollup = {
  totalCost: null,
  ownCost: 0,
  subagentCost: 0,
  subagentCount: 0,
  perChildCost: new Map(),
};

function countDescendants(id: string, childrenByParent: Map<string, Session[]>, visited: Set<string>): number {
  if (visited.has(id)) return 0;
  visited.add(id);
  const kids = childrenByParent.get(id) ?? [];
  let count = kids.length;
  for (const kid of kids) count += countDescendants(kid.id, childrenByParent, visited);
  return count;
}

/**
 * Pure core of useSubagentCostRollup, kept separate so it can be unit-tested
 * directly against a plain session array instead of rendering the hook.
 */
export function computeRollup(liveSessions: Session[], sessionId: string | null): SubagentCostRollup {
  if (!sessionId) return EMPTY_ROLLUP;

  const sessionsById = new Map(liveSessions.map((session) => [session.id, session]));
  if (!sessionsById.has(sessionId)) return EMPTY_ROLLUP;

  const childrenByParent = buildChildrenIndex(liveSessions);
  const totalCost = computeSubtreeCost(sessionId, sessionsById, childrenByParent);

  const perChildCost = new Map<string, number>();
  let subagentCost = 0;
  for (const child of childrenByParent.get(sessionId) ?? []) {
    const childSubtree = computeSubtreeCost(child.id, sessionsById, childrenByParent);
    perChildCost.set(child.id, childSubtree);
    subagentCost += childSubtree;
  }

  // Derived by subtraction rather than read back off the session, so the split
  // always adds up to the total the panel shows even if a cycle guard trimmed
  // part of the walk.
  const ownCost = totalCost - subagentCost;
  const subagentCount = countDescendants(sessionId, childrenByParent, new Set());

  return { totalCost, ownCost, subagentCost, subagentCount, perChildCost };
}

/**
 * Own cost plus every descendant subagent's cost, recursively summed, for a
 * given root session. Reads the same `useAllLiveSessions()` subscription
 * WorkStatusSubagentsSection already holds — no new store subscription.
 *
 * The session costs feed through `accumulateLiveSessionTotals` first, so the
 * rollup sums monotonically-held per-session totals: the shown number keeps
 * counting across a model switch instead of following the server's total down.
 * The split stays consistent because each session is accumulated on its own,
 * before the tree walk, so `ownCost + subagentCost === totalCost` still holds.
 * This hook is the single source of the number for every cost display.
 */
export function useSubagentCostRollup(sessionId: string | null): SubagentCostRollup {
  const liveSessions = useAllLiveSessions();
  const { runtimeKey } = useSyncRuntime();
  return React.useMemo(
    () => computeRollup(accumulateLiveSessionTotals(runtimeKey, liveSessions), sessionId),
    [liveSessions, runtimeKey, sessionId],
  );
}
