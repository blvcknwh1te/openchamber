/**
 * The compaction notice reports how much room the compaction freed, which only
 * the requests around it measured: the last assistant turn before the mark and
 * the first one after. The summary message OpenCode writes for the compaction is
 * itself an assistant turn, but it is the compaction's own output, so counting
 * it as "after" would report the compaction's input, not the context the next
 * request re-read. The same message carries the summary text the notice shows on
 * click, so the two lookups share one neighbour walk.
 */
import { describe, expect, test } from 'bun:test';
import type { AssistantMessage, Part, UserMessage } from '@opencode-ai/sdk/v2';

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
});
