import { describe, expect, test } from 'bun:test';

import type { SlashMention } from '../slashMentions';
import { buildSlashMentionsContext } from '../slashContext';

const mention = (entity: Partial<SlashMention['entity']> & { name: string }): SlashMention => ({
    entity: { kind: 'skill', ...entity },
    start: 0,
    end: entity.name.length + 1,
});

describe('buildSlashMentionsContext', () => {
    test('no mentions produce no instruction', () => {
        expect(buildSlashMentionsContext([])).toBeNull();
    });

    test('names the file that defines each entity', () => {
        const context = buildSlashMentionsContext([
            mention({ kind: 'command', name: 'ship', filePath: '/repo/.opencode/command/ship.md' }),
            mention({ kind: 'skill', name: 'explore', filePath: '/s/explore/SKILL.md' }),
        ]);

        expect(context).toContain('/ship');
        expect(context).toContain('/repo/.opencode/command/ship.md');
        expect(context).toContain('/explore');
        expect(context).toContain('/s/explore/SKILL.md');
    });

    test('an entity without a file keeps its description', () => {
        const context = buildSlashMentionsContext([
            mention({ kind: 'command', name: 'summary', description: 'Recap the session' }),
        ]);

        expect(context).toContain('/summary');
        expect(context).toContain('Recap the session');
    });
});
