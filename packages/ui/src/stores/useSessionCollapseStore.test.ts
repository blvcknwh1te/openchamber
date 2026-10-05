import { beforeEach, describe, expect, test } from 'bun:test';
import { useSessionCollapseStore } from './useSessionCollapseStore';

// Only state transitions are asserted here: the payload format lives in
// `sessionCollapsePersistence` and is covered without mocking, because other
// store tests in the suite replace the shared storage module.
const store = () => useSessionCollapseStore.getState();

const resetStore = () => {
  useSessionCollapseStore.setState({
    collapsedProjectIds: [],
    expandedProjectIds: [],
    knownProjectIds: [],
  });
};

describe('useSessionCollapseStore', () => {
  beforeEach(() => {
    resetStore();
  });

  test('collapseAll folds every registered project and expandAll unfolds them', () => {
    store().registerKnownProjectIds(['project-a', 'project-b']);
    store().collapseAll();

    expect(store().collapsedProjectIds).toEqual(['project-a', 'project-b']);
    expect(store().expandedProjectIds).toEqual([]);

    store().expandAll();
    expect(store().collapsedProjectIds).toEqual([]);
    expect(store().expandedProjectIds).toEqual(['project-a', 'project-b']);
  });

  test('folding everything drops an earlier hand-opened project', () => {
    store().registerKnownProjectIds(['project-a']);
    store().setProjectCollapsed('project-b', false);
    store().collapseAll();

    expect(store().collapsedProjectIds).toEqual(['project-a']);
    expect(store().expandedProjectIds).toEqual([]);
  });

  test('unfolding everything drops an earlier hand-folded project', () => {
    store().registerKnownProjectIds(['project-a']);
    store().setProjectCollapsed('project-b', true);
    store().expandAll();

    expect(store().collapsedProjectIds).toEqual([]);
    expect(store().expandedProjectIds).toEqual(['project-a']);
  });

  test('a project only ever appears in one of the two sets', () => {
    store().setProjectCollapsed('project-a', true);
    expect(store().collapsedProjectIds).toEqual(['project-a']);
    expect(store().expandedProjectIds).toEqual([]);

    store().setProjectCollapsed('project-a', false);
    expect(store().collapsedProjectIds).toEqual([]);
    expect(store().expandedProjectIds).toEqual(['project-a']);

    store().setProjectCollapsed('project-a', true);
    expect(store().collapsedProjectIds).toEqual(['project-a']);
    expect(store().expandedProjectIds).toEqual([]);
  });

  test('repeating a collapse decision keeps the state reference', () => {
    store().setProjectCollapsed('project-a', true);
    const afterFirst = store().collapsedProjectIds;
    store().setProjectCollapsed('project-a', true);
    expect(store().collapsedProjectIds).toBe(afterFirst);
  });

  test('registering the same project list keeps the state reference', () => {
    store().registerKnownProjectIds(['project-a']);
    const afterFirst = store().knownProjectIds;
    store().registerKnownProjectIds(['project-a', 'project-a']);
    expect(store().knownProjectIds).toBe(afterFirst);
  });

  test('registering a different project list replaces it', () => {
    store().registerKnownProjectIds(['project-a']);
    store().registerKnownProjectIds(['project-b']);
    expect(store().knownProjectIds).toEqual(['project-b']);
  });
});
