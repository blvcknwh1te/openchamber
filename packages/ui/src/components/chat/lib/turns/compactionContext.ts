import { extractTokensFromMessage } from '@/stores/utils/tokenUtils';
import type { Part } from '@opencode-ai/sdk/v2';

import { isCompactionSummaryMessage } from './transcriptMessages';
import type { ChatMessageEntry } from './types';

export interface CompactionContextTokens {
    /** Context window the model held on the last request before the compaction. */
    before: number;
    /** Context window the model held on the first request after the compaction. */
    after: number;
}

export interface CompactionContext extends CompactionContextTokens {
    /** Summary text the compaction wrote; it stands in for the earlier messages. */
    summary: string | null;
}

// A summary message is the compaction's own output, not a request the
// conversation asked for: it must never stand in as the context after the mark.
// The ban applies to the token lookup alone; the summary lookup is about the
// record itself, not about what counts as a request.
const isCountingRequest = (message: ChatMessageEntry): boolean =>
    message.info.role === 'assistant' && !isCompactionSummaryMessage(message);

/**
 * True when the message is the compaction's own output written for this notice.
 * OpenCode parents the summary to the notice message, and both projections keep
 * that link: the live row is parented in `buildSummaryEntry`, the persisted row
 * is parented by the server. The link is what tells one compaction's summary
 * from another's, so the lookup does not have to rely on row order - while the
 * summary still streams, its row is appended to the turn in flight, and row
 * order alone would have made the notice unopenable until the turn settled.
 */
const isSummaryWrittenFor = (message: ChatMessageEntry, compactionMessageId: string): boolean => {
    if (!isCompactionSummaryMessage(message)) {
        return false;
    }

    return message.info.role === 'assistant' && message.info.parentID === compactionMessageId;
};

const extractSummaryText = (message: ChatMessageEntry): string => {
    const textParts = message.parts
        .filter((part): part is Extract<Part, { type: 'text' }> => part.type === 'text')
        .map((part) => part.text)
        .join('\n\n');

    return textParts.trim();
};

/**
 * Context size on both sides of a compaction notice, read from the nearest
 * assistant requests around it. Both sides matter: `before` is what the model
 * carried when the window filled up, `after` is what the next request actually
 * re-read, so the pair shows how much room the compaction freed. A side with no
 * measurable neighbour stays 0 rather than hiding the side that was measured.
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

    if (before <= 0 && after <= 0) {
        return null;
    }

    return { before, after };
};

/**
 * Summary text OpenCode wrote for a compaction, taken from the assistant
 * message it flags `summary`. The transcript drops that message from the flow,
 * so the notice is the only place the text can be surfaced from.
 *
 * The row is matched by the parent link the compaction writes, in whatever
 * position it currently sits: a live summary is appended while its turn still
 * streams, and the notice has to be openable then too, not only once the turn
 * settles. The forward walk stays as the fallback for rows without a parent.
 */
export const findCompactionSummary = (
    messages: readonly ChatMessageEntry[],
    compactionMessageId: string,
): string | null => {
    const index = messages.findIndex((message) => message.info.id === compactionMessageId);
    if (index < 0) {
        return null;
    }

    for (const message of messages) {
        if (!isSummaryWrittenFor(message, compactionMessageId)) {
            continue;
        }

        const summary = extractSummaryText(message);
        if (summary.length > 0) {
            return summary;
        }
    }

    for (let cursor = index + 1; cursor < messages.length; cursor += 1) {
        const candidate = messages[cursor];
        if (!candidate || !isCompactionSummaryMessage(candidate)) {
            continue;
        }

        const summary = extractSummaryText(candidate);
        return summary.length > 0 ? summary : null;
    }

    return null;
};

export const findCompactionContext = (
    messages: readonly ChatMessageEntry[],
    compactionMessageId: string,
): CompactionContext | null => {
    const tokens = findCompactionContextTokens(messages, compactionMessageId);
    const summary = findCompactionSummary(messages, compactionMessageId);

    if (!tokens && !summary) {
        return null;
    }

    return {
        before: tokens?.before ?? 0,
        after: tokens?.after ?? 0,
        summary,
    };
};
