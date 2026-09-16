import type { Session } from '@opencode-ai/sdk/v2';

/**
 * Monotonic ledger for the spend and token totals the server reports per
 * session.
 *
 * `Session.cost` and `Session.tokens` are session-wide totals, and the server
 * replaces them wholesale on every `session.updated`. Switching the model
 * mid-chat can bring back a lower total than the one already on screen: the
 * server may recompute the total under the newly selected model, or send a
 * partial payload without the totals at all. Neither cause is observable from
 * the client, so this ledger does not try to explain the drop - it refuses it.
 * A value that has been observed for a session never moves backwards, and the
 * displayed total therefore keeps counting across model switches.
 *
 * Assumption: the server total is cumulative for the session, so a lower
 * observation is a client-visible regression rather than a legitimate
 * correction. Reverting a turn legitimately lowers spend, and this ledger
 * deliberately does not follow it down; the total stays a high-water mark.
 *
 * Scope is runtime + session identity: session IDs are unique within one
 * runtime but not guaranteed unique across connected instances, and the
 * caller already knows the runtime key. Entries are bounded; the oldest
 * observations are dropped at the cap, which can only affect sessions well
 * outside the workspace the user is actually looking at.
 *
 * `accumulateLiveSessionTotals` is a read-time overlay over the aggregated
 * live sessions: consumers keep reading the same list, and sessions whose
 * totals did not move keep their original reference.
 */

/** Observed sessions above this count are pruned in insertion order. */
export const SESSION_COST_LEDGER_LIMIT = 2048;

type SessionTokens = NonNullable<Session['tokens']>;

/** Fields are read defensively: a malformed payload must not break the read. */
type ObservedTokens = {
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: { read?: number; write?: number };
};

type ObservedTotals = {
  cost: number;
  tokens: ObservedTokens | undefined;
};

const observedByRuntimeAndSession = new Map<string, ObservedTotals>();

const ledgerKey = (runtimeKey: string, sessionId: string): string => `${runtimeKey}\n${sessionId}`;

const toNonNegative = (value: number | undefined): number =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;

const readTokens = (tokens: Session['tokens']): ObservedTokens | undefined => tokens
  ? {
    input: toNonNegative(tokens.input),
    output: toNonNegative(tokens.output),
    reasoning: toNonNegative(tokens.reasoning),
    cache: {
      read: toNonNegative(tokens.cache?.read),
      write: toNonNegative(tokens.cache?.write),
    },
  }
  : undefined;

const readObservedTotals = (session: Session): ObservedTotals => ({
  cost: toNonNegative(session.cost),
  tokens: readTokens(session.tokens),
});

const higherTokens = (
  previous: ObservedTokens | undefined,
  next: ObservedTokens | undefined,
): ObservedTokens | undefined => {
  if (!previous) return next;
  if (!next) return previous;
  return {
    input: Math.max(previous.input ?? 0, next.input ?? 0),
    output: Math.max(previous.output ?? 0, next.output ?? 0),
    reasoning: Math.max(previous.reasoning ?? 0, next.reasoning ?? 0),
    cache: {
      read: Math.max(previous.cache?.read ?? 0, next.cache?.read ?? 0),
      write: Math.max(previous.cache?.write ?? 0, next.cache?.write ?? 0),
    },
  };
};

const areTokensEqual = (
  left: ObservedTokens | undefined,
  right: ObservedTokens | undefined,
): boolean => {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.input === right.input
    && left.output === right.output
    && left.reasoning === right.reasoning
    && left.cache?.read === right.cache?.read
    && left.cache?.write === right.cache?.write;
};

const toSessionTokens = (tokens: ObservedTokens): SessionTokens => ({
  input: tokens.input ?? 0,
  output: tokens.output ?? 0,
  reasoning: tokens.reasoning ?? 0,
  cache: {
    read: tokens.cache?.read ?? 0,
    write: tokens.cache?.write ?? 0,
  },
});

const pruneOldest = (): void => {
  while (observedByRuntimeAndSession.size > SESSION_COST_LEDGER_LIMIT) {
    const oldest = observedByRuntimeAndSession.keys().next().value;
    if (oldest === undefined) return;
    observedByRuntimeAndSession.delete(oldest);
  }
};

/**
 * Records what this observation saw and returns the session with the
 * accumulated totals. A session whose totals are already at or below their
 * high-water mark is returned unchanged, reference included.
 */
export function accumulateSessionTotals(runtimeKey: string, session: Session): Session {
  const key = ledgerKey(runtimeKey, session.id);
  const observed = readObservedTotals(session);
  const previous = observedByRuntimeAndSession.get(key);

  if (!previous) {
    observedByRuntimeAndSession.set(key, observed);
    pruneOldest();
    return session;
  }

  const cost = observed.cost > previous.cost ? observed.cost : previous.cost;
  const tokens = higherTokens(previous.tokens, observed.tokens);
  observedByRuntimeAndSession.set(key, { cost, tokens });

  const costChanged = cost !== observed.cost;
  const tokensChanged = !areTokensEqual(tokens, observed.tokens);
  if (!costChanged && !tokensChanged) return session;

  return {
    ...session,
    cost,
    tokens: tokensChanged && tokens ? toSessionTokens(tokens) : session.tokens,
  };
}

/**
 * Applies the ledger to an aggregated live-session list. Returns the input
 * array when no session moved, so unaffected consumers keep their reference.
 */
export function accumulateLiveSessionTotals(runtimeKey: string, sessions: Session[]): Session[] {
  let changed = false;
  const accumulated = sessions.map((session) => {
    const next = accumulateSessionTotals(runtimeKey, session);
    if (next !== session) changed = true;
    return next;
  });
  return changed ? accumulated : sessions;
}

/** Drops every observation. Used by tests and runtime teardown. */
export function resetSessionCostLedger(): void {
  observedByRuntimeAndSession.clear();
}
