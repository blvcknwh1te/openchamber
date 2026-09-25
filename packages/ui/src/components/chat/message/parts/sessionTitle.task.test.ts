import { describe, expect, test } from 'bun:test';

import { isPlaceholderSessionTitle, resolveTaskSessionTitle } from './sessionTitle';
import { formatSubagentTypeLabel } from './subagentTypeLabel';

describe('resolveTaskSessionTitle', () => {
    test('prefers the live session title over subagent_type', () => {
        expect(resolveTaskSessionTitle({
            sessionTitle: 'BETA: Разбор полей session.tokens',
            subagentType: 'explore',
        })).toBe('BETA: Разбор полей session.tokens');
    });

    test('trims the session title before showing it', () => {
        expect(resolveTaskSessionTitle({ sessionTitle: '  ALPHA: Сбор контекста  ', subagentType: 'general' }))
            .toBe('ALPHA: Сбор контекста');
    });

    test('falls back to the capitalized subagent_type while the session title is the server placeholder', () => {
        expect(resolveTaskSessionTitle({ sessionTitle: 'New session', subagentType: 'explore' })).toBe('Explore');
        expect(resolveTaskSessionTitle({ sessionTitle: 'New session - 2026-02-14T09:12:00', subagentType: 'general' }))
            .toBe('General');
    });

    test('falls back to the capitalized subagent_type when the session is not known yet', () => {
        expect(resolveTaskSessionTitle({ subagentType: 'reviewer' })).toBe('Reviewer');
        expect(resolveTaskSessionTitle({ sessionTitle: null, subagentType: 'reviewer' })).toBe('Reviewer');
        expect(resolveTaskSessionTitle({ sessionTitle: '   ', subagentType: 'reviewer' })).toBe('Reviewer');
        expect(resolveTaskSessionTitle({ sessionTitle: undefined, subagentType: undefined })).toBe('Subagent');
    });

    test('keeps the subagent default when the input carries no usable type', () => {
        expect(resolveTaskSessionTitle({ sessionTitle: 'New session', subagentType: '' })).toBe('Subagent');
        expect(resolveTaskSessionTitle({ sessionTitle: 'new session', subagentType: 42 })).toBe('Subagent');
    });
});

describe('isPlaceholderSessionTitle', () => {
    test('treats missing, empty and server placeholder titles as placeholders', () => {
        expect(isPlaceholderSessionTitle(undefined)).toBe(true);
        expect(isPlaceholderSessionTitle(null)).toBe(true);
        expect(isPlaceholderSessionTitle('')).toBe(true);
        expect(isPlaceholderSessionTitle('   ')).toBe(true);
        expect(isPlaceholderSessionTitle('New session')).toBe(true);
        expect(isPlaceholderSessionTitle('new session - 2026-02-14')).toBe(true);
    });

    test('accepts a real generated name, including one that merely mentions a session', () => {
        expect(isPlaceholderSessionTitle('BETA: Разбор полей session.tokens')).toBe(false);
        expect(isPlaceholderSessionTitle('GAMMA: New session handling in the sidebar')).toBe(false);
    });
});

describe('formatSubagentTypeLabel', () => {
    test('capitalizes the first character and keeps the rest', () => {
        expect(formatSubagentTypeLabel('explore')).toBe('Explore');
        expect(formatSubagentTypeLabel('codeReviewer')).toBe('CodeReviewer');
        expect(formatSubagentTypeLabel('  general  ')).toBe('General');
    });

    test('falls back to the default subagent label', () => {
        expect(formatSubagentTypeLabel(undefined)).toBe('Subagent');
        expect(formatSubagentTypeLabel(7)).toBe('Subagent');
    });
});
