/**
 * The sticky prompt header closes with a soft edge, and the strip that paints
 * the user message background (`--chat-user-row-bg`) has to keep that edge.
 *
 * Regression: the strip painted a solid `backgroundColor`, and because the strip
 * renders inside the sticky header it composites above the header's gradient.
 * The fill therefore swallowed the header's fade and left the band ending on a
 * hard line against the chat canvas - the strip looked chopped off at the bottom
 * and the soft edge under it was gone.
 *
 * The strip now paints a background layer built by `stickyFadeBackground`: same
 * fill, same fade length as the header, so the band is intact over its whole box
 * and dissolves into the canvas at its bottom edge.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { STICKY_FADE_LENGTH, stickyFadeBackground } from './stickyFade';

const __dirname = dirname(fileURLToPath(import.meta.url));
const chatMessageSource = readFileSync(join(__dirname, '..', 'ChatMessage.tsx'), 'utf-8');
const turnItemSource = readFileSync(join(__dirname, '..', 'components', 'TurnItem.tsx'), 'utf-8');
const cssGeneratorSource = readFileSync(join(__dirname, '..', '..', '..', 'lib', 'theme', 'cssGenerator.ts'), 'utf-8');

const userRowStyle = stickyFadeBackground('var(--chat-user-row-bg, transparent)');

describe('user message strip', () => {
    test('paints the row colour over the whole strip and fades only the last stretch', () => {
        // The fill stop is measured from the strip's own bottom (`100%`) and the
        // layer is sized by the element, so an opaque row colour covers the strip
        // from its top edge all the way down to the fade - nothing cuts the band.
        expect(userRowStyle.backgroundImage).toBe(
            'linear-gradient(to bottom, var(--chat-user-row-bg, transparent) calc(100% - 0.75rem), transparent 100%)',
        );
        expect(STICKY_FADE_LENGTH).toBe('0.75rem');
    });

    test('keeps the fade in the background layer so the strip content is never faded', () => {
        // A mask or an overlay would fade the strip's own content: the bubble and
        // the hover action row rendered into the gap the strip reserves below the
        // bubble. Only a background layer can soften the canvas underneath them.
        expect(Object.keys(userRowStyle)).toEqual(['backgroundImage']);
    });

    test('fades with the length the sticky header uses, so a painted strip cannot be cut', () => {
        const headerStyle = stickyFadeBackground('var(--surface-background)');
        const headerFade = headerStyle.backgroundImage.slice(headerStyle.backgroundImage.indexOf('calc('));
        const rowFade = userRowStyle.backgroundImage.slice(userRowStyle.backgroundImage.indexOf('calc('));
        expect(headerFade).toBe(rowFade);
        expect(headerStyle.backgroundImage).toContain('var(--surface-background)');
    });

    test('reads the variable the theme declares, and falls back to an unpainted strip', () => {
        expect(cssGeneratorSource).toContain("--chat-user-row-bg: ${chat.userMessageRowBackground || 'transparent'}");
        expect(userRowStyle.backgroundImage).toContain('var(--chat-user-row-bg, transparent)');
    });

    test('is applied as that layer in the chat message markup', () => {
        // The constant is wired to the strip and no solid fill is left behind:
        // one has to hold the other's place, or the fade is covered again.
        expect(chatMessageSource).toContain('style={USER_MESSAGE_ROW_BACKGROUND}');
        expect(chatMessageSource).toContain('chat-user-row');
        expect(chatMessageSource).not.toContain("backgroundColor: 'var(--chat-user-row-bg");
    });

    test('leaves the header gradient in place for strips that paint nothing', () => {
        // With the default transparent row colour the header is the only layer
        // closing the edge, so its own fade has to stay exactly as it was.
        expect(turnItemSource).toContain("stickyFadeBackground('var(--surface-background)')");
        expect(turnItemSource).not.toContain('maskImage');
    });
});
