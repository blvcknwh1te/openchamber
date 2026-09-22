/**
 * Slash entities named in a message, wherever they appear.
 *
 * The send-time scanner used to know only skills and only their exact names,
 * while the editor knew commands and skills separately. Both halves now read
 * the same entity list, so a `/name` is recognised by one membership rule
 * instead of two that drifted apart.
 *
 * The token pattern is only a locator (see `language/prefixTokens.ts`); the
 * entity list is the authority on what exists.
 */

import { scanPrefixTokens } from '../language/prefixTokens';
import type { SlashEntity } from './slashEntities';

export interface SlashMention {
    entity: SlashEntity;
    /** Offset of the `/`. */
    start: number;
    /** Offset just past the name. */
    end: number;
}

/**
 * Known slash entities referenced in `text`, in first-occurrence order.
 * Names match the registered casing, since the name is echoed back to the model.
 */
export const collectSlashMentions = (
    text: string,
    entities: readonly SlashEntity[],
): SlashMention[] => {
    if (!text || entities.length === 0) return [];

    const byName = new Map<string, SlashEntity>();
    for (const entity of entities) byName.set(entity.name, entity);

    const mentions: SlashMention[] = [];
    const seen = new Set<string>();
    for (const token of scanPrefixTokens(text, '/')) {
        const entity = byName.get(token.name);
        if (!entity || seen.has(entity.name)) continue;
        seen.add(entity.name);
        mentions.push({ entity, start: token.start, end: token.end });
    }

    return mentions;
};
