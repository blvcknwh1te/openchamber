/**
 * The compaction notice reports how much room the compaction freed, which only
 * the requests around it measured: the last assistant turn before the mark and
 * the first one after. The summary message OpenCode writes for the compaction is
 * itself an assistant turn, but it is the compaction's own output, so counting
 * it as "after" would report the compaction's input, not the context the next
 * request re-read. That ban belongs to the token lookup alone: the same message
 * carries the summary text the notice shows on click, and the notice has to be
 * openable while that text still streams, before any request follows the mark.
 */
import { describe, expect, test } from 'bun:test';
import type { AssistantMessage, Part, UserMessage } from '@opencode-ai/sdk/v2';

import { liveCompactionEntryIds, projectLiveCompaction } from '@/sync/live-compaction';
import type { LiveCompactionRecord } from '@/sync/types';

import { findCompactionContext, findCompactionContextTokens, findCompactionSummary } from './compactionContext';
import type { ChatMessageEntry } from './types';

const compactionPart = (messageID: string): Part => ({
    id: `${messageID}-compaction`, messageID, sessionID: 'session', type: 'compaction', auto: true,
});

const compactionMessage = (id: string): ChatMessageEntry => ({
    info: {
        id, sessionID: 'session', role: 'user', time: { created: 10 },
        agent: 'build', model: { providerID: 'provider', modelID: 'model' },
    } satisfies UserMessage,
    parts: [compactionPart(id)],
});

const assistantInfo = (id: string, total: number): AssistantMessage => ({
    id, sessionID: 'session', role: 'assistant', time: { created: 1, completed: 2 },
    parentID: 'parent', modelID: 'model', providerID: 'provider', mode: 'build', agent: 'build',
    path: { cwd: '/', root: '/' }, cost: 0,
    tokens: { total, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
});

const summaryInfo = (id: string, total: number): AssistantMessage => ({
    ...assistantInfo(id, total),
    summary: true,
});

const textPart = (messageID: string, text: string): Part => ({
    id: `${messageID}-text`, messageID, sessionID: 'session', type: 'text', text,
});

const assistantMessage = (id: string, total: number, summary = false, parts: Part[] = []): ChatMessageEntry => ({
    info: summary ? summaryInfo(id, total) : assistantInfo(id, total),
    parts,
});

const promptMessage = (id: string): ChatMessageEntry => ({
    info: {
        id, sessionID: 'session', role: 'user', time: { created: 3 },
        agent: 'build', model: { providerID: 'provider', modelID: 'model' },
    } satisfies UserMessage,
    parts: [],
});

/**
 * A compaction output row in the shape both projections write it: an assistant
 * message flagged `summary` and parented to the notice it belongs to. The id is
 * the caller's, so a test can use the persisted one or the live one.
 */
const summaryForNotice = (noticeId: string, id: string, text: string): ChatMessageEntry => ({
    info: { ...summaryInfo(id, 38099), parentID: noticeId },
    parts: [textPart(id, text)],
});

describe('findCompactionContextTokens', () => {
    test('reads the nearest assistant requests on both sides of the mark', () => {
        const messages = [
            assistantMessage('before-1', 111),
            assistantMessage('before-2', 188939),
            promptMessage('prompt'),
            compactionMessage('compact'),
            assistantMessage('after-1', 107496),
            assistantMessage('after-2', 120000),
        ];

        expect(findCompactionContextTokens(messages, 'compact')).toEqual({ before: 188939, after: 107496 });
    });

    test('never treats the compaction summary message as the context after the mark', () => {
        const messages = [
            assistantMessage('before', 188939),
            compactionMessage('compact'),
            assistantMessage('summary', 38099, true),
            assistantMessage('after', 107496),
        ];

        expect(findCompactionContextTokens(messages, 'compact')).toEqual({ before: 188939, after: 107496 });
    });

    test('never counts the summary parented to the notice as a request either', () => {
        const messages = [
            assistantMessage('before', 188939),
            compactionMessage('msg_compact'),
            summaryForNotice('msg_compact', 'msg_compact::live-summary', 'Streaming text.'),
            assistantMessage('after', 107496),
        ];

        expect(findCompactionContextTokens(messages, 'msg_compact')).toEqual({ before: 188939, after: 107496 });
    });

    test('reports the side it could measure when the other is missing', () => {
        const messages = [
            compactionMessage('compact'),
            assistantMessage('after', 107496),
        ];

        expect(findCompactionContextTokens(messages, 'compact')).toEqual({ before: 0, after: 107496 });
    });

    test('returns null when the mark is unknown', () => {
        const messages = [
            assistantMessage('before', 188939),
            promptMessage('prompt'),
        ];

        expect(findCompactionContextTokens(messages, 'missing')).toBeNull();
    });

    test('returns null when no neighbour reported tokens', () => {
        const messages = [
            promptMessage('prompt'),
            compactionMessage('compact'),
            promptMessage('after'),
        ];

        expect(findCompactionContextTokens(messages, 'compact')).toBeNull();
    });
});

describe('findCompactionSummary', () => {
    test('reads the summary text of the flagged assistant message', () => {
        const messages = [
            compactionMessage('compact'),
            assistantMessage('summary', 38099, true, [textPart('summary', 'Earlier work, condensed.')]),
        ];

        expect(findCompactionSummary(messages, 'compact')).toBe('Earlier work, condensed.');
    });

    test('joins several text parts and skips non-text parts', () => {
        const messages = [
            compactionMessage('compact'),
            assistantMessage('summary', 38099, true, [
                textPart('summary', 'First half.'),
                compactionPart('summary'),
                textPart('summary', 'Second half.'),
            ]),
        ];

        expect(findCompactionSummary(messages, 'compact')).toBe('First half.\n\nSecond half.');
    });

    test('returns null when the summary message is missing or empty', () => {
        expect(findCompactionSummary([compactionMessage('compact')], 'compact')).toBeNull();
        expect(findCompactionSummary([
            compactionMessage('compact'),
            assistantMessage('summary', 38099, true, []),
        ], 'compact')).toBeNull();
    });

    test('reads a live summary that is still streaming, with no request after the mark', () => {
        const messages = [
            compactionMessage('msg_compact'),
            summaryForNotice('msg_compact', 'msg_compact::live-summary', 'Condensing the history.'),
        ];

        expect(findCompactionSummary(messages, 'msg_compact')).toBe('Condensing the history.');
    });

    test('reads the persisted summary the server parented to the notice', () => {
        const messages = [
            compactionMessage('msg_compact'),
            summaryForNotice('msg_compact', 'msg_compact_summary', 'Stored condensation.'),
        ];

        expect(findCompactionSummary(messages, 'msg_compact')).toBe('Stored condensation.');
    });

    test('finds the parented summary even when its row lands before the notice', () => {
        const messages = [
            summaryForNotice('msg_compact', 'msg_compact::live-summary', 'Out of order.'),
            compactionMessage('msg_compact'),
        ];

        expect(findCompactionSummary(messages, 'msg_compact')).toBe('Out of order.');
    });

    test('falls back to the next summary row when nothing is parented to the notice', () => {
        const messages = [
            compactionMessage('compact'),
            assistantMessage('summary', 38099, true, [textPart('summary', 'Earlier work, condensed.')]),
        ];

        expect(findCompactionSummary(messages, 'compact')).toBe('Earlier work, condensed.');
    });
});

describe('findCompactionContext', () => {
    test('combines the token window with the summary text', () => {
        const messages = [
            assistantMessage('before', 188939),
            compactionMessage('compact'),
            assistantMessage('summary', 38099, true, [textPart('summary', 'Condensed.')]),
            assistantMessage('after', 107496),
        ];

        expect(findCompactionContext(messages, 'compact')).toEqual({
            before: 188939,
            after: 107496,
            summary: 'Condensed.',
        });
    });

    test('keeps a notice that has a summary but no measurable neighbours', () => {
        const messages = [
            compactionMessage('compact'),
            assistantMessage('summary', 38099, true, [textPart('summary', 'Condensed.')]),
        ];

        expect(findCompactionContext(messages, 'compact')).toEqual({ before: 0, after: 0, summary: 'Condensed.' });
    });

    test('returns null without tokens or a summary', () => {
        expect(findCompactionContext([compactionMessage('compact'), promptMessage('after')], 'compact')).toBeNull();
    });

    test('reads the summary the live projection appends while its turn still streams', () => {
        const record: LiveCompactionRecord = {
            sessionID: 'session',
            messageID: 'msg_compact',
            reason: 'auto',
            streaming: true,
            text: 'Live condensation.',
            startedAt: 10,
        };
        const messages = projectLiveCompaction(record, []);
        const expectedIds = liveCompactionEntryIds(record);

        // The projection writes the notice row first, the summary row after it,
        // with the shared ids the snapshot caches key off.
        expect(messages.map((entry) => entry.info.id)).toEqual(expectedIds);
        expect(expectedIds).toEqual(['msg_compact', 'msg_compact::live-summary']);

        // No request follows the mark yet: the summary alone has to keep the
        // notice openable, at zeroed tokens.
        expect(findCompactionContext(messages, 'msg_compact')).toEqual({
            before: 0,
            after: 0,
            summary: 'Live condensation.',
        });
    });

    test('reads the persisted compaction part and its summary the same way', () => {
        const messages = [
            assistantMessage('before', 188939),
            compactionMessage('msg_compact'),
            summaryForNotice('msg_compact', 'msg_compact_summary', 'Stored condensation.'),
            assistantMessage('after', 107496),
        ];

        expect(findCompactionContext(messages, 'msg_compact')).toEqual({
            before: 188939,
            after: 107496,
            summary: 'Stored condensation.',
        });
    });

    test('keeps the notice openable for a live summary row that streamed before it', () => {
        const record: LiveCompactionRecord = {
            sessionID: 'session',
            messageID: 'msg_compact',
            reason: 'auto',
            streaming: true,
            text: 'Live condensation.',
            startedAt: 10,
        };
        const [notice, summary] = projectLiveCompaction(record, []);

        expect(findCompactionContext([summary, notice], 'msg_compact')).toEqual({
            before: 0,
            after: 0,
            summary: 'Live condensation.',
        });
    });
});
