export interface JsonlEntry {
    /** 1-based source line number. */
    number: number;
    raw: string;
    /** Parsed value, or undefined when the line is blank or invalid JSON. */
    value?: unknown;
    error?: string;
}

export function parseJsonl(text: string): JsonlEntry[] {
    return text
        .split('\n')
        .map((raw, index) => ({ raw, number: index + 1 }))
        .filter((entry) => entry.raw.trim().length > 0)
        .map((entry) => {
            try {
                return { ...entry, value: JSON.parse(entry.raw) as unknown };
            } catch (error) {
                return { ...entry, error: error instanceof Error ? error.message : String(error) };
            }
        });
}

/**
 * Wrap a per-line jq query so one jq call handles the whole file and every output
 * keeps the source line number. Also tags entries so filtered-out lines disappear.
 */
export function tagEntries(entries: JsonlEntry[]): { n: number, v: unknown }[] {
    return entries
        .filter((entry) => entry.error === undefined)
        .map((entry) => ({ n: entry.number, v: entry.value }));
}

export function buildQuery(query: string): string {
    // `.value | query` keeps `.` = the line, exactly like running jq per line.
    return `.[] | (.v | ${query}) as $o | {n: .n, o: $o}`;
}

export function formatJsonlValue(value: unknown): string {
    return JSON.stringify(value, null, 2) ?? String(value);
}
