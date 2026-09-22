import { describe, expect, test } from 'bun:test';

import type { SlashEntity } from '../slashEntities';
import { collectSlashMentions } from '../slashMentions';

const entity = (
    name: string,
    kind: SlashEntity['kind'] = 'skill',
    filePath?: string,
): SlashEntity => ({ kind, name, filePath });

describe('collectSlashMentions', () => {
    test('finds a known entity anywhere in the message', () => {
        const mentions = collectSlashMentions('выполни /ship пожалуйста', [
            entity('ship', 'command', '/repo/ship.md'),
        ]);

        expect(mentions).toHaveLength(1);
        expect(mentions[0].entity.name).toBe('ship');
        expect(mentions[0].start).toBe('выполни '.length);
    });

    test('ignores unknown names and slashes inside prose', () => {
        expect(collectSlashMentions('/nope and a/b', [entity('ship')])).toEqual([]);
    });

    test('keeps first-occurrence order and drops duplicates', () => {
        const mentions = collectSlashMentions('/b then /a then /b', [entity('a'), entity('b')]);

        expect(mentions.map((mention) => mention.entity.name)).toEqual(['b', 'a']);
    });

    test('matches the registered casing only', () => {
        expect(collectSlashMentions('/My_Skill', [entity('my_skill')])).toEqual([]);
        expect(collectSlashMentions('/My_Skill', [entity('My_Skill')])).toHaveLength(1);
    });

    test('an empty entity list scans nothing', () => {
        expect(collectSlashMentions('/ship', [])).toEqual([]);
    });
});
