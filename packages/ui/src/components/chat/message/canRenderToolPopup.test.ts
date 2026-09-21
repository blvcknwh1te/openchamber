import { describe, test, expect } from 'bun:test';

import { canRenderToolPopup, MARKDOWN_POPUP_TOOL, type ToolPopupContent } from './types';

// Regression coverage for DEV1-99: the "expand" action on a Markdown table asked
// the message for a popup carrying Markdown source, but the request was dropped
// because only image and mermaid payloads were accepted. The click looked dead
// even though the dialog already renders Markdown bodies.
describe('canRenderToolPopup', () => {
    const popup = (overrides: Partial<ToolPopupContent>): ToolPopupContent => ({
        open: true,
        title: 'title',
        content: '',
        ...overrides,
    });

    test('accepts a markdown table request', () => {
        expect(canRenderToolPopup(popup({
            content: '| a | b |\n| - | - |\n| 1 | 2 |',
            metadata: { tool: MARKDOWN_POPUP_TOOL },
        }))).toBe(true);
    });

    test('accepts image, mermaid and diff payloads', () => {
        expect(canRenderToolPopup(popup({ image: { url: 'file:///a.png' } }))).toBe(true);
        expect(canRenderToolPopup(popup({ mermaid: { url: 'data:image/svg+xml;base64,AA' } }))).toBe(true);
        expect(canRenderToolPopup(popup({ isDiff: true, diffHunks: [] }))).toBe(true);
    });

    test('rejects a request that carries no renderable payload', () => {
        expect(canRenderToolPopup(popup({}))).toBe(false);
        expect(canRenderToolPopup(popup({ title: 'only a title' }))).toBe(false);
    });
});
