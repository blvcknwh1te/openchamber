import { describe, expect, test } from 'bun:test';
import type { Part, UserMessage } from '@opencode-ai/sdk/v2';

import { getNormalizedMessageForDisplay, hasCompactionPart } from './messageDisplayNormalization';
import type { ChatMessageEntry } from './turns/types';

// SAFETY: OpenCode reports compaction as a part whose `type` the SDK union does
// not model; the display layer reads it defensively for exactly that reason.
const compactionPart = (messageID: string): Part => ({
    id: `${messageID}-compaction`, messageID, sessionID: 'session', type: 'compaction',
} as Part);

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
