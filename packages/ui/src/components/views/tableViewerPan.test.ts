import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

const { panAreaOf, shouldStartPan } = await import('./tableViewerPan');

describe('panAreaOf', () => {
  let windowInstance: Window;

  beforeEach(() => {
    windowInstance = new Window();
    Object.assign(globalThis, {
      window: windowInstance,
      document: windowInstance.document,
      HTMLElement: windowInstance.HTMLElement,
      Node: windowInstance.Node,
    });
  });

  afterEach(async () => {
    await windowInstance.happyDOM.close();
  });

  const buildTable = () => {
    const table = document.createElement('table');
    const body = document.createElement('tbody');
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    const text = document.createTextNode('some value');
    cell.append(text);
    row.append(cell);
    body.append(row);
    table.append(body);
    document.body.append(table);
    return { table, cell, text };
  };

  test('reports the table for a node inside a cell', () => {
    const { text } = buildTable();

    expect(panAreaOf(text)).toBe('table');
  });

  // The cell box and the table frame both belong to the table: a press on the
  // padding of a cell must behave like a press on its words.
  test('reports the table for the box itself, not only for its words', () => {
    const { cell, table } = buildTable();

    expect(panAreaOf(cell)).toBe('table');
    expect(panAreaOf(table)).toBe('table');
  });

  test('reports the surround outside the table', () => {
    const outside = document.createElement('p');
    document.body.append(outside);

    expect(panAreaOf(outside)).toBe('surround');
  });

  test('treats a missing target as the surround', () => {
    expect(panAreaOf(null)).toBe('surround');
    expect(panAreaOf(document.body)).toBe('surround');
  });
});

describe('shouldStartPan', () => {
  const press = (overrides: Partial<Parameters<typeof shouldStartPan>[0]> = {}) => ({
    button: 0,
    ctrlKey: false,
    metaKey: false,
    area: 'surround' as const,
    ...overrides,
  });

  test('pans with the middle button even over cell text', () => {
    expect(shouldStartPan(press({ button: 1, area: 'table' }))).toBe(true);
  });

  test('pans with Ctrl or Cmd and the left button over cell text', () => {
    expect(shouldStartPan(press({ area: 'table', ctrlKey: true }))).toBe(true);
    expect(shouldStartPan(press({ area: 'table', metaKey: true }))).toBe(true);
  });

  test('leaves a plain left press on the table to the browser', () => {
    expect(shouldStartPan(press({ area: 'table' }))).toBe(false);
  });

  test('pans with a plain left press on the surround', () => {
    expect(shouldStartPan(press({ area: 'surround' }))).toBe(true);
  });

  test('ignores the right button', () => {
    expect(shouldStartPan(press({ button: 2 }))).toBe(false);
    expect(shouldStartPan(press({ button: 2, area: 'table', ctrlKey: true }))).toBe(false);
  });
});
