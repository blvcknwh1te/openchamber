import { describe, expect, test } from 'bun:test';
import type { Part, UserMessage } from '@opencode-ai/sdk/v2';

import {
    COMPACTION_COMMAND_TEXTS,
    getNormalizedMessageForDisplay,
    hasCompactionPart,
    hasServiceCompaction,
    isUserPromptMessage,
} from './messageDisplayNormalization';
import type { ChatMessageEntry } from './turns/types';

const compactionPart = (messageID: string): Part => ({
    id: `${messageID}-compaction`, messageID, sessionID: 'session', type: 'compaction', auto: false,
});

const textPart = (messageID: string, text: string): Part => ({
    id: `${messageID}-text`, messageID, sessionID: 'session', type: 'text', text,
});

const syntheticNudgePart = (messageID: string): Part => ({
    id: `${messageID}-synthetic`, messageID, sessionID: 'session', type: 'text',
    text: '<system-reminder>a subagent finished</system-reminder>', synthetic: true,
});

const userMessage = (parts: Part[]): ChatMessageEntry => ({
    info: {
        id: 'msg-1', sessionID: 'session', role: 'user', time: { created: 1 },
        agent: 'build', model: { providerID: 'provider', modelID: 'model' },
    } satisfies UserMessage,
    parts,
});

describe('message display normalization', () => {
    test('keeps a compaction part in place instead of turning it into command text', () => {
        const normalized = getNormalizedMessageForDisplay(userMessage([compactionPart('msg-1')]));

        expect(normalized.parts).toHaveLength(1);
        expect(normalized.parts[0]?.type).toBe('compaction');
    });

    test('reports whether a message carries a compaction part', () => {
        expect(hasCompactionPart(userMessage([compactionPart('msg-1')]))).toBe(true);
        expect(hasCompactionPart(userMessage([]))).toBe(false);
    });
});

describe('hasServiceCompaction', () => {
    test('recognizes the server-written compaction part', () => {
        expect(hasServiceCompaction([compactionPart('msg-1')])).toBe(true);
        expect(hasServiceCompaction([textPart('msg-1', 'hello')])).toBe(false);
        expect(hasServiceCompaction([])).toBe(false);
    });

    test('recognizes every command text listed as a service compaction', () => {
        for (const commandText of COMPACTION_COMMAND_TEXTS) {
            expect(hasServiceCompaction([textPart('msg-1', commandText)])).toBe(true);
            expect(hasServiceCompaction([textPart('msg-1', `  ${commandText}  `)])).toBe(true);
        }
    });

    test('keeps other slash commands as message content', () => {
        expect(hasServiceCompaction([textPart('msg-1', '/summary auth')])).toBe(false);
        expect(hasServiceCompaction([textPart('msg-1', 'no /compact here')])).toBe(false);
    });
});

describe('isUserPromptMessage', () => {
    const noPlanMode = { planModeEnabled: false };

    test('a service compaction notice is not a prompt even though it opens a turn', () => {
        expect(isUserPromptMessage(userMessage([compactionPart('msg-1')]), noPlanMode)).toBe(false);
    });

    test('the local echo of a compaction command is not a prompt either', () => {
        for (const commandText of COMPACTION_COMMAND_TEXTS) {
            expect(isUserPromptMessage(userMessage([textPart('msg-1', commandText)]), noPlanMode)).toBe(false);
            expect(isUserPromptMessage(userMessage([textPart('msg-1', commandText), syntheticNudgePart('msg-1')]), noPlanMode)).toBe(false);
        }
    });

    test('a user message with nothing visible left after normalization is not a prompt', () => {
        expect(isUserPromptMessage(userMessage([syntheticNudgePart('msg-1')]), noPlanMode)).toBe(false);
    });

    test('a user message with content stays a prompt', () => {
        expect(isUserPromptMessage(userMessage([textPart('msg-1', 'Fix the sticky header')]), noPlanMode)).toBe(true);
        expect(isUserPromptMessage(userMessage([textPart('msg-1', '/summary auth')]), noPlanMode)).toBe(true);
        expect(isUserPromptMessage(userMessage([textPart('msg-1', 'look here'), syntheticNudgePart('msg-1')]), noPlanMode)).toBe(true);
    });
});
