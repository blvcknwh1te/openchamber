import { useCallback } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { Session } from '@opencode-ai/sdk/v2';
import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import type { SessionNode } from '../types';

// Session spend, projected from the authoritative global session cache.
//
// A sidebar row cannot read `cost`/`tokens` from the node it is handed: the tree
// is rebuilt only for structural session changes, while the cache moves its
// totals on idle flushes and on events that keep every structural field
// identical. Rows must not load message history either. This index mirrors
// `sync/session-last-model.ts`: a row subscribes to one projected value by
// session id, so a total that moves without a tree rebuild still reaches the
// tooltip while the row's memo comparator stays structural.
//
// `Session.cost` and `Session.tokens` are session-wide (every message the
// session processed, service messages included) but exclude sub-sessions, so
// the row adds every descendant node on top of them.
//
// Authority: the global sessions cache is the complete source for active and
// archived coverage, so this index is a pure projection of it. An entry whose
// totals are unknown or zero is not stored: the row falls back to the session
// record it already holds, which keeps a later partial payload from erasing
// spend the user has already seen.

/** Spend reported for one session id: its own totals, sub-sessions excluded. */
type SessionUsageTotals = {
  cost: number;
  tokens: number;
};

const toSpend = (value: number | undefined): number => (
  value !== undefined && Number.isFinite(value) && value > 0 ? value : 0
);

const sessionCostValue = (session: Session | null | undefined): number => (
  session ? toSpend(session.cost) : 0
);

/** Every bucket the session reports, so no cached or reasoning token is lost. */
const sessionTokensValue = (session: Session | null | undefined): number => {
  const tokens = session?.tokens;
  if (!tokens) return 0;
  return toSpend(tokens.input)
    + toSpend(tokens.output)
    + toSpend(tokens.reasoning)
    + toSpend(tokens.cache?.read)
    + toSpend(tokens.cache?.write);
};

export const sessionOwnUsageTotals = (session: Session | null | undefined): SessionUsageTotals => ({
  cost: sessionCostValue(session),
  tokens: sessionTokensValue(session),
});

/**
 * Reconciles the index against the global session cache. Returns null when
 * nothing changed, so the store keeps its previous map reference; every
 * unchanged session also keeps its previous projected object, so a row
 * subscribed to that leaf does not re-render.
 */
export const reconcileSessionUsageTotals = (
  current: ReadonlyMap<string, SessionUsageTotals>,
  entityById: ReadonlyMap<string, Session>,
): ReadonlyMap<string, SessionUsageTotals> | null => {
  let next: Map<string, SessionUsageTotals> | null = null;
  const draft = (): Map<string, SessionUsageTotals> => (next ??= new Map(current));

  for (const sessionId of current.keys()) {
    if (entityById.has(sessionId)) continue;
    draft().delete(sessionId);
  }

  for (const [sessionId, session] of entityById) {
    const cost = sessionCostValue(session);
    const tokens = sessionTokensValue(session);
    const previous = current.get(sessionId);

    if (cost === 0 && tokens === 0) {
      if (previous) draft().delete(sessionId);
      continue;
    }
    if (previous && previous.cost === cost && previous.tokens === tokens) continue;
    draft().set(sessionId, { cost, tokens });
  }

  return next;
};

type SessionUsageTotalsState = {
  usageById: ReadonlyMap<string, SessionUsageTotals>;
};

const EMPTY_USAGE_BY_ID: ReadonlyMap<string, SessionUsageTotals> = new Map();

export const useSessionUsageTotalsStore = create<SessionUsageTotalsState>(() => ({
  usageById: EMPTY_USAGE_BY_ID,
}));

const publishSessionUsageTotals = (entityById: ReadonlyMap<string, Session>): void => {
  useSessionUsageTotalsStore.setState((state) => {
    const next = reconcileSessionUsageTotals(state.usageById, entityById);
    return next ? { usageById: next } : state;
  });
};

// Module level: the index follows the global cache from the first import, so a
// lazily mounted row already sees the totals the cache carries. A publication
// that leaves `entityById` untouched is skipped, which keeps the projection on
// session changes only.
publishSessionUsageTotals(useGlobalSessionsStore.getState().entityById);
useGlobalSessionsStore.subscribe((state, previousState) => {
  if (state.entityById === previousState.entityById) return;
  publishSessionUsageTotals(state.entityById);
});

/**
 * One session's spend plus every descendant node's spend, recursively. A node
 * the cache does not carry yet — a session created live and not indexed — falls
 * back to the totals its own record carries, so a subtree never silently drops
 * a member it is already rendering.
 */
export const resolveSessionNodeUsageTotals = (
  node: SessionNode,
  usageById: ReadonlyMap<string, SessionUsageTotals>,
): SessionUsageTotals => {
  const visited = new Set<string>();
  let cost = 0;
  let tokens = 0;

  const visit = (current: SessionNode): void => {
    if (visited.has(current.session.id)) return;
    visited.add(current.session.id);

    const own = usageById.get(current.session.id) ?? sessionOwnUsageTotals(current.session);
    cost += own.cost;
    tokens += own.tokens;

    for (const child of current.children) visit(child);
  };

  visit(node);
  return { cost, tokens };
};

/**
 * Totals the row's tooltip reports. The selector rebuilds the subtree sum on
 * every index publication and `useShallow` keeps the render away when both
 * numbers stayed the same, so a total that moved elsewhere never re-renders
 * this row.
 */
export const useSessionNodeUsageTotals = (node: SessionNode): SessionUsageTotals => (
  useSessionUsageTotalsStore(useShallow(useCallback(
    (state) => resolveSessionNodeUsageTotals(node, state.usageById),
    [node],
  )))
);
