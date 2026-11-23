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
 * Sort the data rows by a column, keeping the header first. Also returns, for
 * each displayed row, its index in the original rows, so edits made on the
 * sorted view can be written back to the right row. A negative column keeps
 * the original order.
 */
export function sortCSVRows(
    parsedRows: string[][],
    sortColumn: number,
    sortAscending: boolean
): { rows: string[][], originalIndices: number[] } {
    if (parsedRows.length < 2) {
        return {
            rows: parsedRows,
            originalIndices: parsedRows.map((_, i) => i)
        };
    }

    const headers = parsedRows[0];
    const dataRows = parsedRows.slice(1);
    const originalIndices = dataRows.map((_, i) => i + 1); // 1-based (skip header)

    if (sortColumn < 0) {
        return {
            rows: [headers, ...dataRows],
            originalIndices: [0, ...originalIndices]
        };
    }

    const indexedRows = dataRows.map((row, i) => ({ row, originalIndex: i + 1 }));

    indexedRows.sort((a, b) => {
        const aVal = a.row[sortColumn] || '';
        const bVal = b.row[sortColumn] || '';

        const aNum = parseFloat(aVal.replace(/[,$%]/g, ''));
        const bNum = parseFloat(bVal.replace(/[,$%]/g, ''));

        if (!isNaN(aNum) && !isNaN(bNum)) {
            return sortAscending ? aNum - bNum : bNum - aNum;
        }

        const comparison = aVal.localeCompare(bVal, undefined, { numeric: true, sensitivity: 'base' });
        return sortAscending ? comparison : -comparison;
    });

    return {
        rows: [headers, ...indexedRows.map(r => r.row)],
        originalIndices: [0, ...indexedRows.map(r => r.originalIndex)]
    };
}

/**
 * Read the current value of a cell, treating missing rows and cells as empty.
 */
export function getCellValue(rows: string[][], rowIndex: number, colIndex: number): string {
    return rows[rowIndex]?.[colIndex] ?? '';
}

/**
 * Write a new value into a cell, in place. Short rows are padded with empty
 * strings so serializing never meets a hole. Returns true only when the
 * stored value actually changed, so callers can skip saving no-op edits.
 */
export function applyCellEdit(rows: string[][], rowIndex: number, colIndex: number, newValue: string): boolean {
    const row = rows[rowIndex];
    if (!row) return false;
    if (getCellValue(rows, rowIndex, colIndex) === newValue) return false;

    while (row.length < colIndex) {
        row.push('');
    }
    row[colIndex] = newValue;
    return true;
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
