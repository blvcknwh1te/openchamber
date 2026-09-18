import { extractTokensFromMessage } from '@/stores/utils/tokenUtils';

import { isCompactionSummaryMessage } from './transcriptMessages';
import type { ChatMessageEntry } from './types';

export interface CompactionContextTokens {
    /** Context window the model held on the last request before the compaction. */
    before: number;
    /** Context window the model held on the first request after the compaction. */
    after: number;
}

// A summary message is the compaction's own output, not a request the
// conversation asked for: it must never stand in as the context after the mark.
const isCountingRequest = (message: ChatMessageEntry): boolean =>
    message.info.role === 'assistant' && !isCompactionSummaryMessage(message);

/**
 * Context size on both sides of a compaction notice, read from the nearest
 * assistant requests around it. Both sides matter: `before` is what the model
 * carried when the window filled up, `after` is what the next request actually
 * re-read, so the pair shows how much room the compaction freed.
 */
export const findCompactionContextTokens = (
    messages: readonly ChatMessageEntry[],
    compactionMessageId: string,
): CompactionContextTokens | null => {
    const index = messages.findIndex((message) => message.info.id === compactionMessageId);
    if (index < 0) {
        return null;
    }

    let before = 0;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        const candidate = messages[cursor];
        if (candidate && isCountingRequest(candidate)) {
            before = extractTokensFromMessage(candidate);
            break;
        }
    }

    let after = 0;
    for (let cursor = index + 1; cursor < messages.length; cursor += 1) {
        const candidate = messages[cursor];
        if (candidate && isCountingRequest(candidate)) {
            after = extractTokensFromMessage(candidate);
            break;
        }
    }

    return before > 0 || after > 0 ? { before, after } : null;
};
