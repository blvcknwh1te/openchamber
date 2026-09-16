import { describe, expect, test } from 'bun:test';
import type { AssistantMessage, Part, UserMessage } from '@opencode-ai/sdk/v2';
import type { ChatMessageEntry } from './types';
import { isCompactionSummaryMessage, selectTranscriptMessages } from './transcriptMessages';

const textPart = (messageID: string, text: string): Part => ({
    id: `${messageID}-text`, messageID, sessionID: 'session', type: 'text', text,
});

function user(id: string, summary?: NonNullable<UserMessage['summary']>): ChatMessageEntry {
    const info: UserMessage = {
        id, sessionID: 'session', role: 'user', time: { created: 1 },
        agent: 'build', model: { providerID: 'provider', modelID: 'model' },
    };
    if (summary) {
        info.summary = summary;
    }
    return { info, parts: [textPart(id, '/compact')] };
}

function assistant(id: string, options: { compactionSummary?: boolean } = {}): ChatMessageEntry {
    const info: AssistantMessage = {
        id, sessionID: 'session', role: 'assistant', parentID: 'user', finish: 'stop',
        time: { created: 2, completed: 3 }, modelID: 'model', providerID: 'provider', mode: 'build',
        agent: options.compactionSummary ? 'compaction' : 'build',
        path: { cwd: '/project', root: '/project' }, cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    };
    if (options.compactionSummary) {
        info.summary = true;
    }
    return { info, parts: [textPart(id, options.compactionSummary ? '## Objective' : 'Done.')] };
}

describe('selectTranscriptMessages', () => {
    test('drops the summary message OpenCode stores for a /compact turn', () => {
        const command = user('u1');
        const summary = assistant('a1', { compactionSummary: true });

        expect(selectTranscriptMessages([command, summary])).toEqual([command]);
    });

    test('keeps regular answers in order', () => {
        const messages = [assistant('a1'), assistant('a2'), assistant('a3')];

        expect(selectTranscriptMessages(messages)).toEqual(messages);
    });

    test('keeps a user message whose summary payload carries session diffs', () => {
        const entry = user('u1', { diffs: [] });

        expect(isCompactionSummaryMessage(entry)).toBe(false);
        expect(selectTranscriptMessages([entry])).toEqual([entry]);
    });

    test('returns the same array when nothing is filtered out', () => {
        const messages = [user('u1'), assistant('a1')];

        expect(selectTranscriptMessages(messages)).toBe(messages);
    });
});
