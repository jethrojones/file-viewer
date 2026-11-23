/**
 * Pure helpers for the CSV view: keeping the reader's place and the search
 * filter when the table is rebuilt (for example when toggling Edit mode).
 * No DOM access here, so everything can be unit tested.
 */

export interface RowBox {
    /** Index of the row in the parsed file (header is 0). */
    originalIndex: number;
    /** Vertical position of the row, in the same coordinates as `contentTop`. */
    top: number;
    bottom: number;
    /** True when the row is hidden by the search filter. */
    hidden: boolean;
}

/**
 * Pick the data row that sits at the top of the visible area.
 *
 * `contentTop` is the first pixel below the sticky header, so a row hidden
 * behind the header does not count. A row that is only partly cut by the
 * header still counts as the top row. Rows hidden by the filter are skipped.
 * `rows` is read lazily in display order and the search stops at the first
 * match, so a caller can measure rows on demand. Returns the row's `originalIndex`, or null when nothing is visible.
 */
export function pickAnchorRow(rows: Iterable<RowBox>, contentTop: number): number | null {
    for (const row of rows) {
        if (row.hidden) continue;
        if (row.bottom > contentTop) return row.originalIndex;
    }
    return null;
}

/**
 * Find the row to scroll to after the table is rebuilt. If the anchor row is
 * hidden by the filter or no longer exists, use the next visible row after it.
 * `rows` must be in display order. Returns an index into `rows`, or null.
 */
export function resolveAnchorRow(
    rows: { originalIndex: number; hidden: boolean }[],
    anchor: number
): number | null {
    const start = rows.findIndex(row => row.originalIndex === anchor);
    if (start === -1) return null;
    for (let i = start; i < rows.length; i++) {
        if (!rows[i].hidden) return i;
    }
    return null;
}

/**
 * New `scrollTop` that puts a row exactly at `contentTop` (just below the
 * sticky header). The browser clamps values past the end of the content.
 */
export function scrollTopForRow(currentScrollTop: number, rowTop: number, contentTop: number): number {
    return Math.max(0, currentScrollTop + (rowTop - contentTop));
}

/** True when any cell of the row contains the query (case-insensitive). An empty query matches everything. */
export function rowMatchesQuery(cellTexts: string[], query: string): boolean {
    if (!query) return true;
    const needle = query.toLowerCase();
    return cellTexts.some(text => text.toLowerCase().includes(needle));
}

/** Text of the row counter: "N of M rows" while filtering, "M rows · C columns" otherwise. */
export function formatRowInfo(query: string, visibleCount: number, totalRows: number, columnCount: number): string {
    if (query) {
        return `${visibleCount.toLocaleString()} of ${totalRows.toLocaleString()} rows`;
    }
    return `${totalRows.toLocaleString()} rows · ${columnCount} columns`;
}
