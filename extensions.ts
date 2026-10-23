/** Turn a user-typed list like "jsonl, .ndjson  out" into ['jsonl', 'ndjson', 'out']. */
export function parseExtensionList(input: string | null | undefined): string[] {
    const extensions = (input ?? '')
        .split(/[\s,]+/)
        .map((ext) => ext.replace(/^\.+/, '').toLowerCase())
        .filter((ext) => ext.length > 0);

    return Array.from(new Set(extensions));
}
