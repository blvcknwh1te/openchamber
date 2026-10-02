import { isolateHistory } from '@codemirror/commands';
import { Transaction, type EditorState, type TransactionSpec } from '@codemirror/state';

/**
 * Replace a document range and leave the caret inside the resulting document.
 *
 * CodeMirror normalizes line endings on the way in: a `\r\n` pair becomes one
 * line break, so the inserted string is longer than the text it produces. A
 * caret derived from the JavaScript string therefore lands past the end of the
 * document and `dispatch` throws `RangeError: Selection points outside of
 * document`. The transaction never applies, so the un-normalized text stays in
 * React state, gets persisted as a draft, and crashes the chat again on every
 * restore (issue #3013).
 *
 * Deriving the caret from the change set instead keeps it correct for whatever
 * CodeMirror actually inserted, without this module having to know the
 * normalization rules.
 */
export const replaceWithCaret = (
    state: EditorState,
    from: number,
    to: number,
    insert: string,
    caret?: { anchor: number; head: number },
): TransactionSpec => {
    const changes = state.changes({ from, to, insert });
    const clamp = (position: number): number => Math.min(Math.max(position, 0), changes.newLength);
    // What CodeMirror inserted, measured on the document rather than on the
    // string: the new length minus everything the change left untouched.
    const insertedLength = changes.newLength - (state.doc.length - (to - from));
    const anchor = caret ? clamp(caret.anchor) : from + insertedLength;
    const head = caret ? clamp(caret.head) : anchor;
    return { changes, selection: { anchor, head } };
};

export interface DocumentRange {
    from: number;
    to: number;
    insert: string;
}

/**
 * The smallest change that turns `current` into `next`: the common prefix and
 * suffix are left untouched and only the differing middle is replaced.
 *
 * A wholesale `{ from: 0, to: doc.length }` change looks equivalent on screen
 * but is not equivalent to CodeMirror's history. A transaction that is not
 * recorded (`addToHistory: false`) still maps every existing history event
 * through its change set, and a change spanning the whole document maps all of
 * them onto the new document — undoing a keystroke then restores the entire
 * pre-rewrite document instead of the single keystroke. Restricting the change
 * to the real difference keeps the untouched parts of the history valid.
 */
export const diffDocumentRange = (current: string, next: string): DocumentRange => {
    let from = 0;
    const shared = Math.min(current.length, next.length);
    while (from < shared && current[from] === next[from]) from += 1;
    let to = current.length;
    let nextEnd = next.length;
    while (to > from && nextEnd > from && current[to - 1] === next[nextEnd - 1]) {
        to -= 1;
        nextEnd -= 1;
    }
    return { from, to, insert: next.slice(from, nextEnd) };
};

/**
 * The transaction that writes an externally supplied value into the editor.
 *
 * The composer is controlled: React state can change the document without the
 * user typing (draft restore, history recall, a value arriving from a store).
 * Such a rewrite is not a keystroke and must not become an undo step, so it is
 * annotated `addToHistory.of(false)` — and because the transaction is not in
 * the history, undo after it reverts the user's last real edit rather than the
 * synchronization. Only the actual difference is dispatched (see
 * `diffDocumentRange`), otherwise the mapping would invalidate that history.
 *
 * Returns null when the document already matches, so callers can skip the
 * dispatch entirely. The caret is placed at the end of the resulting document,
 * matching what replacing a textarea's value used to do.
 */
export const externalSyncTransaction = (
    state: EditorState,
    next: string,
): TransactionSpec | null => {
    const current = state.doc.toString();
    if (current === next) return null;
    const { from, to, insert } = diffDocumentRange(current, next);
    const changes = state.changes({ from, to, insert });
    return {
        changes,
        selection: { anchor: changes.newLength, head: changes.newLength },
        annotations: Transaction.addToHistory.of(false),
    };
};

/**
 * The transaction for an insertion the composer performs on the user's behalf:
 * picking a mention, agent, skill, snippet or slash token.
 *
 * It is tagged `input.type`, so the edit reads as user input, but
 * `isolateHistory.of('full')` keeps it a single undo step: without it the
 * insertion would merge with whatever was typed just before, and Ctrl+Z would
 * roll back both. Isolated, undo removes exactly the picked token and leaves the
 * typed text; a second undo then removes the typing.
 */
export const programmaticEditTransaction = (
    state: EditorState,
    edit: { from: number; to: number; insert: string; caret?: { anchor: number; head: number } },
): TransactionSpec => ({
    ...replaceWithCaret(state, edit.from, edit.to, edit.insert, edit.caret),
    userEvent: 'input.type',
    annotations: isolateHistory.of('full'),
});
