import { describe, it, expect } from 'vitest';
import { parseCSV, parseSortableNumber, parseTranscript, serializeCSV } from './csv-parser';

describe('parseCSV', () => {
    it('parses simple CSV with headers', () => {
        const csv = 'Name,Age,City\nAlice,30,NYC\nBob,25,LA';
        const result = parseCSV(csv);
        expect(result).toEqual([
            ['Name', 'Age', 'City'],
            ['Alice', '30', 'NYC'],
            ['Bob', '25', 'LA']
        ]);
    });

    it('handles quoted fields with commas', () => {
        const csv = 'Name,Description\nJohn,"Hello, World"\nJane,"A, B, C"';
        const result = parseCSV(csv);
        expect(result).toEqual([
            ['Name', 'Description'],
            ['John', 'Hello, World'],
            ['Jane', 'A, B, C']
        ]);
    });

    it('handles escaped quotes inside quoted fields', () => {
        const csv = 'Name,Quote\nBob,"He said ""Hello"""\nAlice,"Test ""one"" and ""two"""';
        const result = parseCSV(csv);
        expect(result).toEqual([
            ['Name', 'Quote'],
            ['Bob', 'He said "Hello"'],
            ['Alice', 'Test "one" and "two"']
        ]);
    });

    it('handles newlines inside quoted fields', () => {
        const csv = 'Name,Address\nJohn,"123 Main St\nApt 4"\nJane,"456 Oak Ave"';
        const result = parseCSV(csv);
        expect(result).toEqual([
            ['Name', 'Address'],
            ['John', '123 Main St\nApt 4'],
            ['Jane', '456 Oak Ave']
        ]);
    });

    it('handles CRLF line endings', () => {
        const csv = 'A,B\r\n1,2\r\n3,4';
        const result = parseCSV(csv);
        expect(result).toEqual([
            ['A', 'B'],
            ['1', '2'],
            ['3', '4']
        ]);
    });

    it('trims whitespace from unquoted cells', () => {
        const csv = 'Name,  Age  \n  Alice  ,  30  ';
        const result = parseCSV(csv);
        expect(result).toEqual([
            ['Name', 'Age'],
            ['Alice', '30']
        ]);
    });

    it('preserves whitespace in quoted cells', () => {
        const csv = 'Name,Value\n"  Alice  ","  30  "';
        const result = parseCSV(csv);
        expect(result).toEqual([
            ['Name', 'Value'],
            ['  Alice  ', '  30  ']
        ]);
    });

    it('skips empty rows', () => {
        const csv = 'A,B\n\n1,2\n\n3,4';
        const result = parseCSV(csv);
        expect(result).toEqual([
            ['A', 'B'],
            ['1', '2'],
            ['3', '4']
        ]);
    });

    it('handles empty string', () => {
        expect(parseCSV('')).toEqual([]);
    });

    it('handles single cell', () => {
        expect(parseCSV('hello')).toEqual([['hello']]);
    });

    it('handles trailing newline', () => {
        const csv = 'A,B\n1,2\n';
        const result = parseCSV(csv);
        expect(result).toEqual([
            ['A', 'B'],
            ['1', '2']
        ]);
    });
});

describe('serializeCSV', () => {
    it('serializes simple data', () => {
        const rows = [['A', 'B'], ['1', '2']];
        expect(serializeCSV(rows)).toBe('A,B\n1,2');
    });

    it('quotes fields with commas', () => {
        const rows = [['Name', 'Value'], ['Test', 'A, B']];
        expect(serializeCSV(rows)).toBe('Name,Value\nTest,"A, B"');
    });

    it('escapes quotes in fields', () => {
        const rows = [['Name'], ['Say "Hello"']];
        expect(serializeCSV(rows)).toBe('Name\n"Say ""Hello"""');
    });

    it('quotes fields with newlines', () => {
        const rows = [['Addr'], ['Line 1\nLine 2']];
        expect(serializeCSV(rows)).toBe('Addr\n"Line 1\nLine 2"');
    });
});

describe('round-trip', () => {
    it('can parse and serialize back to equivalent CSV', () => {
        const original = [
            ['Name', 'Description', 'Value'],
            ['Item 1', 'Has a comma, here', '100'],
            ['Item 2', 'Has "quotes"', '200'],
            ['Item 3', 'Normal text', '300']
        ];
        const serialized = serializeCSV(original);
        const parsed = parseCSV(serialized);
        expect(parsed).toEqual(original);
    });
});

describe('parseSortableNumber', () => {
    it('parses plain integers and decimals', () => {
        expect(parseSortableNumber('42')).toBe(42);
        expect(parseSortableNumber('3.14')).toBe(3.14);
        expect(parseSortableNumber('.5')).toBe(0.5);
        expect(parseSortableNumber('7.')).toBe(7);
    });

    it('parses signed numbers and exponents', () => {
        expect(parseSortableNumber('-5')).toBe(-5);
        expect(parseSortableNumber('+5')).toBe(5);
        expect(parseSortableNumber('1e3')).toBe(1000);
        expect(parseSortableNumber('-2.5E-2')).toBe(-0.025);
    });

    it('ignores thousands separators, currency and percent symbols', () => {
        expect(parseSortableNumber('$1,234.56')).toBe(1234.56);
        expect(parseSortableNumber('12%')).toBe(12);
        expect(parseSortableNumber('1,000,000')).toBe(1000000);
    });

    it('ignores surrounding whitespace', () => {
        expect(parseSortableNumber('  42  ')).toBe(42);
    });

    it('returns null for date-like values', () => {
        expect(parseSortableNumber('2026-07-14')).toBeNull();
        expect(parseSortableNumber('2026/07/14')).toBeNull();
        expect(parseSortableNumber('14/07/2026')).toBeNull();
        expect(parseSortableNumber('2026-07')).toBeNull();
    });

    it('returns null for text, mixed values and empty values', () => {
        expect(parseSortableNumber('')).toBeNull();
        expect(parseSortableNumber('   ')).toBeNull();
        expect(parseSortableNumber('abc')).toBeNull();
        expect(parseSortableNumber('12abc')).toBeNull();
        expect(parseSortableNumber('abc12')).toBeNull();
        expect(parseSortableNumber('1.2.3')).toBeNull();
        expect(parseSortableNumber('-')).toBeNull();
        expect(parseSortableNumber('.')).toBeNull();
        expect(parseSortableNumber('1e')).toBeNull();
    });

    describe('as used by the column sort', () => {
        // Same comparison as the sort in the table view: numeric only when both values are numbers.
        const sortColumn = (values: string[], ascending: boolean) =>
            [...values].sort((a, b) => {
                const aNum = parseSortableNumber(a);
                const bNum = parseSortableNumber(b);
                if (aNum !== null && bNum !== null) {
                    return ascending ? aNum - bNum : bNum - aNum;
                }
                const comparison = a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
                return ascending ? comparison : -comparison;
            });

        const dates = ['2026-04-06', '2026-07-14', '2025-02-13'];

        it('sorts ISO dates in full, ascending', () => {
            expect(sortColumn(dates, true)).toEqual(['2025-02-13', '2026-04-06', '2026-07-14']);
        });

        it('sorts ISO dates in full, descending', () => {
            expect(sortColumn(dates, false)).toEqual(['2026-07-14', '2026-04-06', '2025-02-13']);
        });

        it('still sorts numbers as numbers', () => {
            expect(sortColumn(['10', '9', '100', '-3'], true)).toEqual(['-3', '9', '10', '100']);
            expect(sortColumn(['$1,000', '$250.50', '$99'], true)).toEqual(['$99', '$250.50', '$1,000']);
            expect(sortColumn(['50%', '7%', '100%'], false)).toEqual(['100%', '50%', '7%']);
        });

        it('still sorts text alphabetically', () => {
            expect(sortColumn(['pear', 'Apple', 'banana'], true)).toEqual(['Apple', 'banana', 'pear']);
        });
    });
});

describe('parseTranscript', () => {
    it('parses SRT cues with indices and multiline text', () => {
        const srt = [
            '1',
            '00:00:01,000 --> 00:00:03,500',
            'Hello there.',
            'Welcome back.',
            '',
            '2',
            '00:00:05,250 --> 00:00:07,000',
            'Next cue'
        ].join('\n');

        expect(parseTranscript(srt, 'srt')).toEqual([
            {
                number: 1,
                start: '00:00:01,000',
                end: '00:00:03,500',
                text: 'Hello there.\nWelcome back.'
            },
            {
                number: 2,
                start: '00:00:05,250',
                end: '00:00:07,000',
                text: 'Next cue'
            }
        ]);
    });

    it('parses VTT cues while skipping headers and notes', () => {
        const vtt = [
            'WEBVTT',
            '',
            'NOTE generated by example',
            'this note should be ignored',
            '',
            'intro',
            '00:00:01.000 --> 00:00:03.500 align:start position:0%',
            'Hello from VTT.',
            '',
            '00:00:05.250 --> 00:00:07.000',
            'Second cue'
        ].join('\n');

        expect(parseTranscript(vtt, 'vtt')).toEqual([
            {
                number: 1,
                start: '00:00:01.000',
                end: '00:00:03.500',
                text: 'Hello from VTT.'
            },
            {
                number: 2,
                start: '00:00:05.250',
                end: '00:00:07.000',
                text: 'Second cue'
            }
        ]);
    });
});
