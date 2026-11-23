/**
 * Parse CSV text into a 2D array of strings.
 * RFC 4180 compliant - handles quoted fields, escaped quotes, and mixed line endings.
 */
export function parseCSV(csvText: string): string[][] {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentCell = '';
    let inQuotes = false;
    let wasQuoted = false;

    for (let i = 0; i < csvText.length; i++) {
        const char = csvText[i];
        const nextChar = csvText[i + 1];

        if (inQuotes) {
            if (char === '"') {
                if (nextChar === '"') {
                    // Escaped quote
                    currentCell += '"';
                    i++;
                } else {
                    // End of quoted field
                    inQuotes = false;
                }
            } else {
                currentCell += char;
            }
        } else {
            if (char === '"') {
                inQuotes = true;
                wasQuoted = true;
            } else if (char === ',') {
                currentRow.push(wasQuoted ? currentCell : currentCell.trim());
                currentCell = '';
                wasQuoted = false;
            } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
                currentRow.push(wasQuoted ? currentCell : currentCell.trim());
                if (currentRow.length > 0 && currentRow.some(cell => cell !== '')) {
                    rows.push(currentRow);
                }
                currentRow = [];
                currentCell = '';
                wasQuoted = false;
                if (char === '\r') i++;
            } else if (char !== '\r') {
                currentCell += char;
            }
        }
    }

    // Handle last row (no trailing newline)
    if (currentCell || currentRow.length > 0) {
        currentRow.push(wasQuoted ? currentCell : currentCell.trim());
        if (currentRow.some(cell => cell !== '')) {
            rows.push(currentRow);
        }
    }

    return rows;
}

/**
 * Serialize a 2D array back to CSV text.
 * Properly quotes fields containing commas, quotes, or newlines.
 */
export function serializeCSV(rows: string[][]): string {
    return rows.map(row =>
        row.map(cell => {
            if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
                return '"' + cell.replace(/"/g, '""') + '"';
            }
            return cell;
        }).join(',')
    ).join('\n');
}

/**
 * Parse a cell value as a number for sorting, or return null if it is not one.
 * The whole value must be a number (after removing the `,`, `$` and `%`
 * symbols), so values that only start with digits, like dates (2026-07-14),
 * are not treated as numbers.
 */
export function parseSortableNumber(value: string): number | null {
    const cleaned = value.replace(/[,$%]/g, '').trim();
    if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(cleaned)) {
        return null;
    }
    return Number(cleaned);
}

export type TranscriptFormat = 'srt' | 'vtt';

export interface TranscriptCue {
    number: number;
    start: string;
    end: string;
    text: string;
}

/**
 * Parse SRT or WebVTT text into display-ready transcript cues.
 */
export function parseTranscript(transcriptText: string, _format: TranscriptFormat): TranscriptCue[] {
    const blocks = transcriptText
        .replace(/\r\n?/g, '\n')
        .split(/\n{2,}/)
        .map(block => block.split('\n').map(line => line.trim()).filter(line => line.length > 0));

    const cues: TranscriptCue[] = [];
    const timestampPattern = /((?:\d{2}:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d{2}:)?\d{2}:\d{2}[.,]\d{3})/;

    for (const block of blocks) {
        if (block.length === 0) continue;

        const firstLine = block[0].toUpperCase();
        if (
            firstLine.startsWith('WEBVTT') ||
            firstLine.startsWith('NOTE') ||
            firstLine.startsWith('STYLE') ||
            firstLine.startsWith('REGION')
        ) {
            continue;
        }

        const timingLineIndex = block.findIndex(line => line.includes('-->'));
        if (timingLineIndex === -1) continue;

        const timingMatch = block[timingLineIndex].match(timestampPattern);
        if (!timingMatch) continue;

        cues.push({
            number: cues.length + 1,
            start: timingMatch[1],
            end: timingMatch[2],
            text: block.slice(timingLineIndex + 1).join('\n')
        });
    }

    return cues;
}
