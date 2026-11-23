import { describe, it, expect } from 'vitest';
import { formatRowInfo, pickAnchorRow, resolveAnchorRow, rowMatchesQuery, scrollTopForRow } from './csv-position';

const box = (originalIndex: number, top: number, height = 30, hidden = false) => ({
    originalIndex,
    top,
    bottom: top + height,
    hidden
});

describe('pickAnchorRow', () => {
    it('picks the first row when scrolled to the top', () => {
        const rows = [box(1, 40), box(2, 70), box(3, 100)];
        expect(pickAnchorRow(rows, 40)).toBe(1);
    });

    it('skips rows scrolled out above the header', () => {
        const rows = [box(1, -50), box(2, -20), box(3, 10), box(4, 40)];
        expect(pickAnchorRow(rows, 40)).toBe(4);
    });

    it('keeps a row that is only partly behind the header', () => {
        const rows = [box(1, 0), box(2, 30), box(3, 60)];
        expect(pickAnchorRow(rows, 40)).toBe(2);
    });

    it('skips rows hidden by the filter', () => {
        const rows = [box(1, 40, 30, true), box(2, 40, 30, true), box(3, 40)];
        expect(pickAnchorRow(rows, 40)).toBe(3);
    });

    it('uses the original index, not the position, when the table is sorted', () => {
        const rows = [box(7, 40), box(2, 70), box(5, 100)];
        expect(pickAnchorRow(rows, 40)).toBe(7);
    });

    it('returns null when no row is visible', () => {
        expect(pickAnchorRow([], 40)).toBeNull();
        expect(pickAnchorRow([box(1, 40, 30, true)], 40)).toBeNull();
        expect(pickAnchorRow([box(1, -100)], 40)).toBeNull();
    });
});

describe('resolveAnchorRow', () => {
    const rows = [
        { originalIndex: 1, hidden: false },
        { originalIndex: 2, hidden: true },
        { originalIndex: 3, hidden: true },
        { originalIndex: 4, hidden: false }
    ];

    it('returns the anchor when it is visible', () => {
        expect(resolveAnchorRow(rows, 1)).toBe(0);
        expect(resolveAnchorRow(rows, 4)).toBe(3);
    });

    it('uses the next visible row when the anchor is hidden', () => {
        expect(resolveAnchorRow(rows, 2)).toBe(3);
        expect(resolveAnchorRow(rows, 3)).toBe(3);
    });

    it('follows display order, not index order', () => {
        const sorted = [
            { originalIndex: 9, hidden: true },
            { originalIndex: 1, hidden: false }
        ];
        expect(resolveAnchorRow(sorted, 9)).toBe(1);
    });

    it('returns null when the anchor is missing or nothing after it is visible', () => {
        expect(resolveAnchorRow(rows, 99)).toBeNull();
        expect(resolveAnchorRow([{ originalIndex: 1, hidden: true }], 1)).toBeNull();
    });
});

describe('scrollTopForRow', () => {
    it('scrolls down when the row is below the content top', () => {
        expect(scrollTopForRow(1000, 340, 40)).toBe(1300);
    });

    it('scrolls up when the row is above the content top', () => {
        expect(scrollTopForRow(1000, -60, 40)).toBe(900);
    });

    it('does nothing when the row is already in place', () => {
        expect(scrollTopForRow(500, 40, 40)).toBe(500);
    });

    it('never goes negative', () => {
        expect(scrollTopForRow(10, -200, 40)).toBe(0);
    });
});

describe('rowMatchesQuery', () => {
    it('matches everything for an empty query', () => {
        expect(rowMatchesQuery(['a', 'b'], '')).toBe(true);
        expect(rowMatchesQuery([], '')).toBe(true);
    });

    it('matches any cell, ignoring case', () => {
        expect(rowMatchesQuery(['Alice', 'NYC'], 'nyc')).toBe(true);
        expect(rowMatchesQuery(['Alice', 'NYC'], 'ALI')).toBe(true);
    });

    it('does not match when no cell contains the query', () => {
        expect(rowMatchesQuery(['Alice', 'NYC'], 'bob')).toBe(false);
        expect(rowMatchesQuery([], 'x')).toBe(false);
    });
});

describe('formatRowInfo', () => {
    it('shows rows and columns without a query', () => {
        expect(formatRowInfo('', 500, 500, 4)).toBe('500 rows · 4 columns');
    });

    it('shows "N of M rows" with a query', () => {
        expect(formatRowInfo('abc', 12, 500, 4)).toBe('12 of 500 rows');
    });
});
