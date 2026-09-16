import { useCallback } from 'react';
import { create } from 'zustand';
import type { Session } from '@opencode-ai/sdk/v2';
import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';

// Last model used by each session, projected from the global session cache.
//
// A sidebar row cannot read the model from the row node it is handed: the tree
// is rebuilt only for structural session changes, while the server records the
// model together with a recency-only `time.updated` (see the sidebar
// documentation, "Global session subscriptions are structural"). Rows must also
// not load message history to find the model. This index mirrors
// `global-session-status.ts`: it projects one narrow, reference-stable value per
// session that a row subscribes to by ID, so the badge follows the
// authoritative cache without a tree rebuild and without a history request.
//
// Authority: the global sessions cache is the complete source for active and
// archived coverage, so the index is a pure projection of it. Entries follow
// `entityById` exactly, including the runtime-switch reset, and no other source
// can add or keep one.

type SessionLastModel = {
  providerID: string;
  modelID: string;
  variant?: string;
};

type SessionLastModelState = {
  modelById: ReadonlyMap<string, SessionLastModel>;
};

const EMPTY_MODEL_BY_ID: ReadonlyMap<string, SessionLastModel> = new Map();

export const useSessionLastModelStore = create<SessionLastModelState>(() => ({
  modelById: EMPTY_MODEL_BY_ID,
}));

/**
 * Projects a session record's `model` into the display shape. A payload without
 * a usable provider or model ID resolves to null instead of a half-filled badge.
 */
export const toSessionLastModel = (model: Session['model'] | null | undefined): SessionLastModel | null => {
  if (!model) return null;
  const providerID = model.providerID?.trim() ?? '';
  const modelID = model.id?.trim() ?? '';
  if (!providerID || !modelID) return null;
  const variant = model.variant?.trim();
  return variant ? { providerID, modelID, variant } : { providerID, modelID };
};

const sameSessionLastModel = (left: SessionLastModel, right: SessionLastModel): boolean => (
  left.providerID === right.providerID
  && left.modelID === right.modelID
  && left.variant === right.variant
);

/**
 * Reconciles the index against the global session cache. Returns null when
 * nothing changed, so the store keeps its previous map reference; every
 * unchanged session also keeps its previous projected object, so a row
 * subscribed to that leaf does not re-render.
 */
export const reconcileSessionLastModels = (
  current: ReadonlyMap<string, SessionLastModel>,
  entityById: ReadonlyMap<string, Session>,
): ReadonlyMap<string, SessionLastModel> | null => {
  let next: Map<string, SessionLastModel> | null = null;
  const draft = (): Map<string, SessionLastModel> => (next ??= new Map(current));

  for (const sessionId of current.keys()) {
    if (entityById.has(sessionId)) continue;
    draft().delete(sessionId);
  }

  for (const [sessionId, session] of entityById) {
    const projected = toSessionLastModel(session.model);
    const previous = current.get(sessionId);
    if (!projected) {
      if (previous) draft().delete(sessionId);
      continue;
    }
    if (previous && sameSessionLastModel(previous, projected)) continue;
    draft().set(sessionId, projected);
  }

  return next;
};

const publishSessionLastModels = (entityById: ReadonlyMap<string, Session>): void => {
  useSessionLastModelStore.setState((state) => {
    const next = reconcileSessionLastModels(state.modelById, entityById);
    return next ? { modelById: next } : state;
  });
};

// Module level: the index follows the global cache from the first import, so a
// lazily mounted row still sees the models the cache already carries. A
// publication that leaves `entityById` untouched (status or page state) is
// skipped, which keeps the scan on session changes only.
publishSessionLastModels(useGlobalSessionsStore.getState().entityById);
useGlobalSessionsStore.subscribe((state, previousState) => {
  if (state.entityById === previousState.entityById) return;
  publishSessionLastModels(state.entityById);
});

export const useSessionLastModel = (sessionId: string): SessionLastModel | null => (
  useSessionLastModelStore(useCallback((state) => state.modelById.get(sessionId) ?? null, [sessionId]))
);