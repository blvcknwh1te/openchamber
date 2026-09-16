import { beforeEach, describe, expect, test } from 'bun:test';
import type { Session } from '@opencode-ai/sdk/v2';

import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import {
  reconcileSessionLastModels,
  toSessionLastModel,
  useSessionLastModelStore,
} from './session-last-model';

const buildSession = (id: string, model?: Session['model']): Session => {
  const base: Session = {
    id,
    slug: id,
    projectID: 'project-1',
    directory: '/repo',
    title: id,
    version: '1.0.0',
    time: { created: 1, updated: 2 },
  };
  return model ? { ...base, model } : base;
};

const publishEntities = (sessions: Session[]): void => {
  useGlobalSessionsStore.setState({
    entityById: new Map(sessions.map((session) => [session.id, session])),
  });
};

beforeEach(() => {
  useSessionLastModelStore.setState({ modelById: new Map() });
  useGlobalSessionsStore.setState({ entityById: new Map() });
});

describe('session last model projection', () => {
  test('normalizes the model fields a row renders', () => {
    expect(toSessionLastModel({ id: ' claude-sonnet-4 ', providerID: ' anthropic ', variant: ' high ' })).toEqual({
      providerID: 'anthropic',
      modelID: 'claude-sonnet-4',
      variant: 'high',
    });
  });

  test('drops an omitted variant and a half-filled model', () => {
    expect(toSessionLastModel({ id: 'gpt-5', providerID: 'openai' })).toEqual({
      providerID: 'openai',
      modelID: 'gpt-5',
    });
    expect(toSessionLastModel({ id: '', providerID: 'openai' })).toBe(null);
    expect(toSessionLastModel(undefined)).toBe(null);
  });
});

describe('session last model reconciliation', () => {
  test('reports no change when the cache projects to the same index', () => {
    const current = reconcileSessionLastModels(
      new Map(),
      new Map([['session-a', buildSession('session-a', { id: 'gpt-5', providerID: 'openai' })]]),
    );
    const unchanged = reconcileSessionLastModels(
      current ?? new Map(),
      new Map([['session-a', buildSession('session-a', { id: 'gpt-5', providerID: 'openai' })]]),
    );

    expect(unchanged).toBe(null);
  });

  test('adds, updates, and removes entries while keeping unaffected references', () => {
    const first = reconcileSessionLastModels(
      new Map(),
      new Map([
        ['session-a', buildSession('session-a', { id: 'gpt-5', providerID: 'openai' })],
        ['session-b', buildSession('session-b', { id: 'gpt-5', providerID: 'openai' })],
      ]),
    );
    const sessionB = first?.get('session-b');

    const second = reconcileSessionLastModels(
      first ?? new Map(),
      new Map([
        ['session-a', buildSession('session-a', { id: 'claude-sonnet-4', providerID: 'anthropic' })],
        ['session-b', buildSession('session-b', { id: 'gpt-5', providerID: 'openai' })],
        ['session-c', buildSession('session-c', { id: 'gpt-5', providerID: 'openai' })],
      ]),
    );

    expect(second).not.toBe(null);
    expect(second?.get('session-a')).toEqual({ providerID: 'anthropic', modelID: 'claude-sonnet-4' });
    expect(second?.get('session-b')).toBe(sessionB);
    expect(second?.has('session-c')).toBe(true);

    const third = reconcileSessionLastModels(
      second ?? new Map(),
      new Map([['session-c', buildSession('session-c', { id: 'gpt-5', providerID: 'openai' })]]),
    );

    expect([...(third?.keys() ?? [])]).toEqual(['session-c']);
  });

  test('drops an entry once its session reports no model', () => {
    const current = reconcileSessionLastModels(
      new Map(),
      new Map([['session-a', buildSession('session-a', { id: 'gpt-5', providerID: 'openai' })]]),
    );
    const next = reconcileSessionLastModels(
      current ?? new Map(),
      new Map([['session-a', buildSession('session-a')]]),
    );

    expect(next).not.toBe(null);
    expect(next?.size).toBe(0);
  });
});

describe('session last model index wiring', () => {
  test('follows the global session cache as rows mount', () => {
    publishEntities([buildSession('session-a', { id: 'gpt-5', providerID: 'openai' })]);

    expect(useSessionLastModelStore.getState().modelById.get('session-a')).toEqual({
      providerID: 'openai',
      modelID: 'gpt-5',
    });

    const entry = useSessionLastModelStore.getState().modelById.get('session-a');
    publishEntities([
      buildSession('session-a', { id: 'gpt-5', providerID: 'openai' }),
      buildSession('session-b', { id: 'claude-sonnet-4', providerID: 'anthropic' }),
    ]);

    expect(useSessionLastModelStore.getState().modelById.get('session-a')).toBe(entry);
    expect(useSessionLastModelStore.getState().modelById.get('session-b')).toEqual({
      providerID: 'anthropic',
      modelID: 'claude-sonnet-4',
    });
  });

  test('clears with the global cache when the runtime resets', () => {
    publishEntities([buildSession('session-a', { id: 'gpt-5', providerID: 'openai' })]);
    expect(useSessionLastModelStore.getState().modelById.size).toBe(1);

    publishEntities([]);

    expect(useSessionLastModelStore.getState().modelById.size).toBe(0);
  });
});