import { describe, test, expect } from 'bun:test';

import { isWorkingSessionStatus } from './session-status';

describe('isWorkingSessionStatus', () => {
    test('treats busy and retry as working', () => {
        expect(isWorkingSessionStatus({ type: 'busy' })).toBe(true);
        expect(isWorkingSessionStatus({ type: 'retry' })).toBe(true);
    });

    test('treats idle, other statuses and missing records as not working', () => {
        expect(isWorkingSessionStatus({ type: 'idle' })).toBe(false);
        expect(isWorkingSessionStatus({ type: 'cooldown' })).toBe(false);
        expect(isWorkingSessionStatus({})).toBe(false);
        expect(isWorkingSessionStatus(undefined)).toBe(false);
    });
});
