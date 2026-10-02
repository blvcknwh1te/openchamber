import { describe, expect, test } from 'bun:test';
import { history, isolateHistory, redo, undo, undoDepth } from '@codemirror/commands';
import { EditorState, Transaction } from '@codemirror/state';

import { diffDocumentRange, externalSyncTransaction, programmaticEditTransaction } from '../documentEdits';

const create = (doc: string) => EditorState.create({ doc, extensions: [history()] });

/** A keystroke at the end of the document, grouped by CodeMirror as typing. */
const typeText = (state: EditorState, text: string) => state.update({
    changes: { from: state.doc.length, insert: text },
    selection: { anchor: state.doc.length + text.length },
    userEvent: 'input.type',
}).state;

const apply = (state: EditorState, spec: ReturnType<typeof programmaticEditTransaction>) =>
    state.update(spec).state;

const runUndo = (state: EditorState) => {
    const sink: EditorState[] = [];
    const ok = undo({ state, dispatch: (transaction) => { sink.push(transaction.state); } });
    return { ok, state: sink[0] ?? state };
};

const runRedo = (state: EditorState) => {
    const sink: EditorState[] = [];
    const ok = redo({ state, dispatch: (transaction) => { sink.push(transaction.state); } });
    return { ok, state: sink[0] ?? state };
};

describe('diffDocumentRange', () => {
    test('reports only the inserted middle for a shared prefix and suffix', () => {
        expect(diffDocumentRange('hello world', 'hello brave world'))
            .toEqual({ from: 6, to: 6, insert: 'brave ' });
    });

    test('reports a deletion in the middle', () => {
        expect(diffDocumentRange('hello brave world', 'hello world'))
            .toEqual({ from: 6, to: 12, insert: '' });
    });

    test('reports a wholesale replacement as one range', () => {
        // `old draft` and `restored text` share the trailing `t`, so the
        // replacement stops before it.
        expect(diffDocumentRange('old draft', 'restored text'))
            .toEqual({ from: 0, to: 8, insert: 'restored tex' });
    });

    test('reports a no-op for identical text', () => {
        expect(diffDocumentRange('same', 'same')).toEqual({ from: 4, to: 4, insert: '' });
    });
});

describe('externalSyncTransaction (writeback)', () => {
    test('returns null when the document already matches', () => {
        expect(externalSyncTransaction(create('same'), 'same')).toBeNull();
    });

    test('is excluded from the undo history', () => {
        const state = create('hello world');
        const spec = externalSyncTransaction(state, 'hello brave world');
        expect(spec).not.toBeNull();
        const transaction = state.update(spec!);
        expect(transaction.annotation(Transaction.addToHistory)).toBe(false);
    });

    test('dispatches the difference, not the whole document', () => {
        const state = create('hello world');
        const spec = externalSyncTransaction(state, 'hello brave world');
        const ranges: Array<[number, number]> = [];
        state.update(spec!).changes.iterChanges((fromA, toA) => ranges.push([fromA, toA]));

        expect(ranges).toEqual([[6, 6]]);
    });

    test('does not add an undo step', () => {
        let state = create('');
        state = typeText(state, 'abc');
        const depth = undoDepth(state);

        state = state.update(externalSyncTransaction(state, 'abcabc')!).state;

        expect(undoDepth(state)).toBe(depth);
    });

    test('undo after a draft load reverts the next typing, not the load', () => {
        let state = create('');
        state = state.update(externalSyncTransaction(state, 'restored draft')!).state;
        state = typeText(state, '!');

        expect(state.doc.toString()).toBe('restored draft!');
        const undone = runUndo(state);
        expect(undone.ok).toBe(true);
        expect(undone.state.doc.toString()).toBe('restored draft');
    });
});

describe('programmaticEditTransaction (picked mention/snippet)', () => {
    test('reads as typed input and is isolated in the history', () => {
        const state = create('hello @fi');
        const spec = programmaticEditTransaction(state, { from: 6, to: 9, insert: '@src/app.ts ' });
        const transaction = state.update(spec);

        expect(transaction.isUserEvent('input.type')).toBe(true);
        expect(transaction.annotation(isolateHistory)).toBe('full');
    });

    test('is not a full-document replace', () => {
        const state = create('hello @fi');
        const spec = programmaticEditTransaction(state, { from: 6, to: 9, insert: '@src/app.ts ' });
        const ranges: Array<[number, number]> = [];
        state.update(spec).changes.iterChanges((fromA, toA) => ranges.push([fromA, toA]));

        expect(ranges).toEqual([[6, 9]]);
    });

    test('undo removes exactly the picked token, then the typing', () => {
        let state = create('');
        state = typeText(state, 'hello @fi');
        state = apply(state, programmaticEditTransaction(state, { from: 6, to: 9, insert: '@src/app.ts ' }));
        expect(state.doc.toString()).toBe('hello @src/app.ts ');

        const first = runUndo(state);
        expect(first.state.doc.toString()).toBe('hello @fi');

        const second = runUndo(first.state);
        expect(second.state.doc.toString()).toBe('');
    });

    test('redo restores the picked token after it was undone', () => {
        let state = create('');
        state = typeText(state, 'hello @fi');
        state = apply(state, programmaticEditTransaction(state, { from: 6, to: 9, insert: '@src/app.ts ' }));

        const undone = runUndo(state);
        const redone = runRedo(undone.state);

        expect(redone.ok).toBe(true);
        expect(redone.state.doc.toString()).toBe('hello @src/app.ts ');
    });
});
