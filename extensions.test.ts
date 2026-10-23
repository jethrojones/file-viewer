import { describe, expect, it } from 'vitest';
import { parseExtensionList } from './extensions';

describe('parseExtensionList', () => {
    it('splits on commas and whitespace, strips dots, lowercases, dedupes', () => {
        expect(parseExtensionList(' jsonl, .NDJSON\n out ')).toEqual(['jsonl', 'ndjson', 'out']);
    });

    it('returns an empty list for empty or missing input', () => {
        expect(parseExtensionList('')).toEqual([]);
        expect(parseExtensionList(undefined)).toEqual([]);
        expect(parseExtensionList(null)).toEqual([]);
    });
});
