import { describe, expect, it } from 'vitest';
import { loadJq } from 'jq-wasm/inline';
import { buildQuery, parseJsonl, tagEntries } from './jsonl';

describe('parseJsonl', () => {
    it('parses lines, keeps 1-based line numbers, skips blanks and flags bad lines', () => {
        const entries = parseJsonl('{"a":1}\n\nnot json\n{"b":2}\n');

        expect(entries.map((entry) => entry.number)).toEqual([1, 3, 4]);
        expect(entries[0].value).toEqual({ a: 1 });
        expect(entries[1].error).toBeTruthy();
        expect(entries[2].value).toEqual({ b: 2 });
    });
});

describe('jq pipeline over jsonl', () => {
    it('filters and reshapes while keeping source line numbers', async () => {
        const jq = await loadJq();
        const entries = parseJsonl(['{"level":"info","n":1}', '{"level":"error","n":2}', '{"level":"error","n":3}'].join('\n'));

        const out = jq.json(tagEntries(entries), buildQuery('select(.level == "error") | .n')) as { n: number, o: unknown }[];

        expect(out.map((row) => [row.n, row.o])).toEqual([[2, 2], [3, 3]]);
    });

    it('reports jq errors instead of throwing raw', async () => {
        const jq = await loadJq();
        expect(() => jq.json([{ n: 1, v: { a: 1 } }], buildQuery('.a |'))).toThrow();
    });
});
