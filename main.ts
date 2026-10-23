import { App, Notice, Plugin, PluginSettingTab, Setting, TextFileView, WorkspaceLeaf } from 'obsidian';
import { Jq, loadJq } from 'jq-wasm/inline';
import { parseCSV, parseTranscript, serializeCSV, TranscriptCue, TranscriptFormat } from './csv-parser';
import { parseExtensionList } from './extensions';
import { buildQuery, formatJsonlValue, JsonlEntry, parseJsonl, tagEntries } from './jsonl';
import { formatJson, minifyJson, validateJson } from './json-utils';
import { SUPPORT_ISSUES_URL } from './support';

const CSV_VIEW_TYPE = 'csv-view';
const LOG_VIEW_TYPE = 'log-view';
const TRANSCRIPT_VIEW_TYPE = 'transcript-view';
const JSON_VIEW_TYPE = 'json-view';
const JSONL_VIEW_TYPE = 'jsonl-view';

interface CSVViewerSettings {
    enableCsvViewer: boolean;
    enableLogViewer: boolean;
    enableVttViewer: boolean;
    enableSrtViewer: boolean;
    enableJsonViewer: boolean;
    enableJsonlViewer: boolean;
    /** Viewer key -> user-typed extra extensions, e.g. { json: 'jsonl, ndjson' }. */
    extraExtensions: Record<string, string>;
}

const DEFAULT_SETTINGS: CSVViewerSettings = {
    enableCsvViewer: true,
    enableLogViewer: true,
    enableVttViewer: true,
    enableSrtViewer: true,
    enableJsonViewer: true,
    enableJsonlViewer: true,
    extraExtensions: {}
};

interface ViewerConfig {
    key: string;
    viewType: string;
    enable: 'enableCsvViewer' | 'enableLogViewer' | 'enableVttViewer' | 'enableSrtViewer' | 'enableJsonViewer' | 'enableJsonlViewer';
    name: string;
    desc: string;
    extensions: string[];
}

const VIEWERS: ViewerConfig[] = [
    {
        key: 'csv',
        viewType: CSV_VIEW_TYPE,
        enable: 'enableCsvViewer',
        name: 'CSV viewer',
        desc: 'Open .csv files in the interactive table viewer.',
        extensions: ['csv']
    },
    {
        key: 'log',
        viewType: LOG_VIEW_TYPE,
        enable: 'enableLogViewer',
        name: 'Log / text viewer',
        desc: 'Open .log and .txt files in the filtered log viewer.',
        extensions: ['log', 'txt']
    },
    {
        key: 'vtt',
        viewType: TRANSCRIPT_VIEW_TYPE,
        enable: 'enableVttViewer',
        name: '.vtt transcript viewer',
        desc: 'Open .vtt files in the transcript viewer.',
        extensions: ['vtt']
    },
    {
        key: 'srt',
        viewType: TRANSCRIPT_VIEW_TYPE,
        enable: 'enableSrtViewer',
        name: '.srt transcript viewer',
        desc: 'Open .srt files in the transcript viewer.',
        extensions: ['srt']
    },
    {
        key: 'json',
        viewType: JSON_VIEW_TYPE,
        enable: 'enableJsonViewer',
        name: 'JSON viewer',
        desc: 'Open .json files in an editable JSON viewer with validation and formatting controls.',
        extensions: ['json']
    },
    {
        key: 'jsonl',
        viewType: JSONL_VIEW_TYPE,
        enable: 'enableJsonlViewer',
        name: 'JSONL viewer',
        desc: 'Open .jsonl files as pretty-printed records with a jq filter bar.',
        extensions: ['jsonl']
    }
];

type LogLevel = 'error' | 'warning' | 'info' | 'debug' | 'default';

interface LogLine {
    number: number;
    text: string;
    level: LogLevel;
}

class CSVView extends TextFileView {
    data: string = '';
    parsedRows: string[][] = [];
    sortColumn: number = -1;
    sortAscending: boolean = true;
    editMode: boolean = false;

    getViewType(): string {
        return CSV_VIEW_TYPE;
    }

    getDisplayText(): string {
        return this.file?.basename || 'CSV';
    }

    getIcon(): string {
        return 'table';
    }

    onOpen(): Promise<void> {
        this.contentEl.addClass('csv-view-container');
        return Promise.resolve();
    }

    onClose(): Promise<void> {
        this.contentEl.empty();
        return Promise.resolve();
    }

    getViewData(): string {
        return this.data;
    }

    setViewData(data: string, _clear: boolean): void {
        this.data = data;
        this.parsedRows = parseCSV(data);
        this.sortColumn = -1;
        this.sortAscending = true;
        this.renderCSV();
    }

    clear(): void {
        this.data = '';
        this.parsedRows = [];
        this.contentEl.empty();
    }

    getSortedRows(): { rows: string[][], originalIndices: number[] } {
        if (this.parsedRows.length < 2) {
            return {
                rows: this.parsedRows,
                originalIndices: this.parsedRows.map((_, i) => i)
            };
        }

        const headers = this.parsedRows[0];
        const dataRows = this.parsedRows.slice(1);
        const originalIndices = dataRows.map((_, i) => i + 1); // 1-based (skip header)

        if (this.sortColumn < 0) {
            return {
                rows: [headers, ...dataRows],
                originalIndices: [0, ...originalIndices]
            };
        }

        const indexedRows = dataRows.map((row, i) => ({ row, originalIndex: i + 1 }));

        indexedRows.sort((a, b) => {
            const aVal = a.row[this.sortColumn] || '';
            const bVal = b.row[this.sortColumn] || '';

            const aNum = parseFloat(aVal.replace(/[,$%]/g, ''));
            const bNum = parseFloat(bVal.replace(/[,$%]/g, ''));

            if (!isNaN(aNum) && !isNaN(bNum)) {
                return this.sortAscending ? aNum - bNum : bNum - aNum;
            }

            const comparison = aVal.localeCompare(bVal, undefined, { numeric: true, sensitivity: 'base' });
            return this.sortAscending ? comparison : -comparison;
        });

        return {
            rows: [headers, ...indexedRows.map(r => r.row)],
            originalIndices: [0, ...indexedRows.map(r => r.originalIndex)]
        };
    }

    renderCSV() {
        this.contentEl.empty();

        const container = this.contentEl.createDiv({ cls: 'csv-view-content' });

        const { rows, originalIndices } = this.getSortedRows();

        if (rows.length === 0) {
            container.createEl('p', { text: 'No data in CSV file', cls: 'csv-view-info' });
            return;
        }

        // Toolbar
        const toolbar = container.createDiv({ cls: 'csv-view-toolbar' });

        const searchInput = toolbar.createEl('input', {
            cls: 'csv-view-search',
            attr: { type: 'text', placeholder: '🔍 Search...' }
        });

        const editBtn = toolbar.createEl('button', {
            text: 'Edit',
            cls: 'csv-edit-btn' + (this.editMode ? ' active' : '')
        });
        editBtn.addEventListener('click', () => {
            this.editMode = !this.editMode;
            this.renderCSV();
        });

        const info = toolbar.createDiv({ cls: 'csv-view-info' });
        const dataRowCount = rows.length - 1;
        const colCount = rows[0]?.length || 0;
        info.textContent = `${dataRowCount.toLocaleString()} rows · ${colCount} columns`;

        // Table
        const tableWrapper = container.createDiv({ cls: 'csv-table-wrapper' });
        const tableScroll = tableWrapper.createDiv({ cls: 'csv-table-scroll' });
        const table = tableScroll.createEl('table', { cls: 'csv-table' });

        // Header
        const thead = table.createEl('thead');
        const headerRow = thead.createEl('tr');
        const headers = rows[0] || [];

        headers.forEach((header, index) => {
            const th = headerRow.createEl('th');
            const thContent = th.createDiv({ cls: 'th-content' });
            thContent.createSpan({ text: header, cls: 'th-text', attr: { title: header } });

            if (this.sortColumn === index) {
                th.addClass('sorted');
                thContent.createSpan({
                    text: this.sortAscending ? '▲' : '▼',
                    cls: 'sort-indicator'
                });
            }

            if (this.editMode) {
                th.addClass('sort-disabled');
            } else {
                th.addEventListener('click', () => {
                    if (this.sortColumn === index) {
                        if (this.sortAscending) {
                            this.sortAscending = false;
                        } else {
                            this.sortColumn = -1;
                            this.sortAscending = true;
                        }
                    } else {
                        this.sortColumn = index;
                        this.sortAscending = true;
                    }
                    this.renderCSV();
                });
            }
        });

        // Body
        const tbody = table.createEl('tbody');
        for (let i = 1; i < rows.length; i++) {
            const tr = tbody.createEl('tr');
            const originalRowIndex = originalIndices[i];

            for (let j = 0; j < headers.length; j++) {
                const cellValue = rows[i][j] || '';
                const td = tr.createEl('td', { text: cellValue, attr: { title: cellValue } });

                if (this.editMode) {
                    // Use contenteditable="true" for broad Obsidian/Electron compatibility;
                    // intercept paste to strip rich text.
                    td.setAttribute('contenteditable', 'true');
                    td.removeAttribute('title');

                    td.addEventListener('paste', (e: ClipboardEvent) => {
                        e.preventDefault();
                        const text = e.clipboardData?.getData('text/plain') || '';
                        const selection = window.getSelection();
                        if (!selection || selection.rangeCount === 0) return;

                        const range = selection.getRangeAt(0);
                        range.deleteContents();
                        range.insertNode(td.ownerDocument.createTextNode(text));
                        range.collapse(false);
                        selection.removeAllRanges();
                        selection.addRange(range);
                    });

                    td.addEventListener('blur', () => {
                        const newValue = td.textContent || '';
                        if (newValue !== cellValue) {
                            this.parsedRows[originalRowIndex][j] = newValue;
                            this.data = serializeCSV(this.parsedRows);
                            this.requestSave();
                        }
                    });

                    td.addEventListener('keydown', (e: KeyboardEvent) => {
                        if (e.key === 'Tab') {
                            e.preventDefault();
                            const allCells = Array.from(tbody.querySelectorAll('td[contenteditable]'));
                            const currentIndex = allCells.indexOf(td);
                            const nextIndex = e.shiftKey ? currentIndex - 1 : currentIndex + 1;
                            if (nextIndex >= 0 && nextIndex < allCells.length) {
                                (allCells[nextIndex] as HTMLElement).focus();
                            }
                        } else if (e.key === 'Escape') {
                            td.blur();
                        }
                    });
                }
            }
        }

        // Search
        searchInput.addEventListener('input', () => {
            const query = searchInput.value.toLowerCase();
            const bodyRows = tbody.querySelectorAll('tr');
            let visibleCount = 0;

            bodyRows.forEach((row) => {
                const cells = row.querySelectorAll('td');
                let matches = false;

                cells.forEach((cell) => {
                    const text = cell.textContent?.toLowerCase() || '';
                    if (text.includes(query)) {
                        matches = true;
                        if (query) {
                            cell.addClass('csv-highlight');
                        } else {
                            cell.removeClass('csv-highlight');
                        }
                    } else {
                        cell.removeClass('csv-highlight');
                    }
                });

                if (matches || !query) {
                    row.removeClass('csv-row-hidden');
                    visibleCount++;
                } else {
                    row.addClass('csv-row-hidden');
                }
            });

            if (query) {
                info.textContent = `${visibleCount.toLocaleString()} of ${dataRowCount.toLocaleString()} rows`;
            } else {
                info.textContent = `${dataRowCount.toLocaleString()} rows · ${colCount} columns`;
            }
        });
    }
}

class LogView extends TextFileView {
    data: string = '';
    lines: LogLine[] = [];
    filteredLines: LogLine[] = [];
    showErrors: boolean = true;
    showWarnings: boolean = true;
    showInfo: boolean = true;
    showDebug: boolean = true;
    autoScroll: boolean = true;
    searchQuery: string = '';

    getViewType(): string {
        return LOG_VIEW_TYPE;
    }

    getDisplayText(): string {
        return this.file?.basename || 'Log';
    }

    getIcon(): string {
        return 'file-text';
    }

    onOpen(): Promise<void> {
        this.contentEl.addClass('log-view-container');
        return Promise.resolve();
    }

    onClose(): Promise<void> {
        this.contentEl.empty();
        return Promise.resolve();
    }

    getViewData(): string {
        return this.data;
    }

    setViewData(data: string, _clear: boolean): void {
        this.data = data;
        this.lines = data.split('\n').map((line, index) => ({
            number: index + 1,
            text: line,
            level: this.detectLogLevel(line)
        }));
        this.applyFilters();
        this.renderLog();
    }

    clear(): void {
        this.data = '';
        this.lines = [];
        this.filteredLines = [];
        this.contentEl.empty();
    }

    detectLogLevel(line: string): LogLevel {
        const upper = line.toUpperCase();

        if (upper.includes('ERROR') || upper.includes('FATAL') || upper.includes('CRITICAL')) {
            return 'error';
        }

        if (upper.includes('WARN')) {
            return 'warning';
        }

        if (upper.includes('DEBUG') || upper.includes('TRACE')) {
            return 'debug';
        }

        if (upper.includes('INFO')) {
            return 'info';
        }

        return 'default';
    }

    applyFilters(): void {
        const query = this.searchQuery.toLowerCase();

        this.filteredLines = this.lines.filter((line) => {
            if (line.level === 'error' && !this.showErrors) return false;
            if (line.level === 'warning' && !this.showWarnings) return false;
            if (line.level === 'info' && !this.showInfo) return false;
            if (line.level === 'debug' && !this.showDebug) return false;

            if (query) {
                return line.text.toLowerCase().includes(query);
            }

            return true;
        });
    }

    renderLog(): void {
        this.contentEl.empty();

        const container = this.contentEl.createDiv({ cls: 'log-view-content' });
        const toolbar = container.createDiv({ cls: 'log-view-toolbar' });

        const searchInput = toolbar.createEl('input', {
            cls: 'log-view-search',
            attr: { type: 'text', placeholder: 'Filter...' }
        });
        searchInput.value = this.searchQuery;

        const errorBtn = this.createFilterButton(toolbar, 'Errors', 'error', this.showErrors);
        const warnBtn = this.createFilterButton(toolbar, 'Warnings', 'warning', this.showWarnings);
        const infoBtn = this.createFilterButton(toolbar, 'Info', 'info', this.showInfo);
        const debugBtn = this.createFilterButton(toolbar, 'Debug', 'debug', this.showDebug);

        const scrollBtn = toolbar.createEl('button', {
            text: 'Auto-scroll',
            cls: 'log-scroll-btn' + (this.autoScroll ? ' active' : '')
        });

        const info = toolbar.createDiv({ cls: 'log-view-info' });
        const logLines = container.createDiv({ cls: 'log-lines' });

        searchInput.addEventListener('input', () => {
            this.searchQuery = searchInput.value;
            this.applyFilters();
            this.renderLogLines(logLines, info);
        });

        errorBtn.addEventListener('click', () => {
            this.showErrors = !this.showErrors;
            errorBtn.toggleClass('active', this.showErrors);
            this.applyFilters();
            this.renderLogLines(logLines, info);
        });

        warnBtn.addEventListener('click', () => {
            this.showWarnings = !this.showWarnings;
            warnBtn.toggleClass('active', this.showWarnings);
            this.applyFilters();
            this.renderLogLines(logLines, info);
        });

        infoBtn.addEventListener('click', () => {
            this.showInfo = !this.showInfo;
            infoBtn.toggleClass('active', this.showInfo);
            this.applyFilters();
            this.renderLogLines(logLines, info);
        });

        debugBtn.addEventListener('click', () => {
            this.showDebug = !this.showDebug;
            debugBtn.toggleClass('active', this.showDebug);
            this.applyFilters();
            this.renderLogLines(logLines, info);
        });

        scrollBtn.addEventListener('click', () => {
            this.autoScroll = !this.autoScroll;
            scrollBtn.toggleClass('active', this.autoScroll);
            if (this.autoScroll) {
                logLines.scrollTop = logLines.scrollHeight;
            }
        });

        this.renderLogLines(logLines, info);
    }

    createFilterButton(parent: HTMLElement, text: string, level: LogLevel, active: boolean): HTMLButtonElement {
        return parent.createEl('button', {
            text,
            cls: `log-filter-btn ${level}` + (active ? ' active' : '')
        });
    }

    renderLogLines(container: HTMLElement, info: HTMLElement): void {
        container.empty();

        if (this.filteredLines.length === 0) {
            container.createDiv({ cls: 'log-empty', text: 'No matching log lines' });
            info.textContent = `0 of ${this.lines.length.toLocaleString()} lines`;
            return;
        }

        info.textContent = `${this.filteredLines.length.toLocaleString()} of ${this.lines.length.toLocaleString()} lines`;

        for (const line of this.filteredLines) {
            const lineEl = container.createDiv({ cls: `log-line ${line.level}` });
            lineEl.createDiv({ cls: 'log-line-number', text: String(line.number) });

            const textEl = lineEl.createDiv({ cls: 'log-line-text' });
            this.renderLogLineText(textEl, line.text || ' ');
        }

        if (this.autoScroll) {
            container.scrollTop = container.scrollHeight;
        }
    }

    renderLogLineText(parent: HTMLElement, text: string): void {
        const timestampPattern = /\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?|\[\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}\]/g;
        const matches = this.findTextMatches(text, this.searchQuery, timestampPattern);

        for (const match of matches) {
            if (match.className) {
                parent.createSpan({ text: match.text, cls: match.className });
            } else {
                parent.appendText(match.text);
            }
        }
    }

    findTextMatches(text: string, query: string, timestampPattern: RegExp): { text: string, className?: string }[] {
        const ranges: { start: number, end: number, className: string }[] = [];
        let timestampMatch: RegExpExecArray | null;

        while ((timestampMatch = timestampPattern.exec(text)) !== null) {
            ranges.push({
                start: timestampMatch.index,
                end: timestampMatch.index + timestampMatch[0].length,
                className: 'log-timestamp'
            });
        }

        if (query) {
            const lowerText = text.toLowerCase();
            const lowerQuery = query.toLowerCase();
            let index = lowerText.indexOf(lowerQuery);

            while (index !== -1) {
                ranges.push({
                    start: index,
                    end: index + query.length,
                    className: 'log-highlight'
                });
                index = lowerText.indexOf(lowerQuery, index + query.length);
            }
        }

        ranges.sort((a, b) => a.start - b.start || b.end - a.end);

        const segments: { text: string, className?: string }[] = [];
        let position = 0;

        for (const range of ranges) {
            if (range.start < position) continue;

            if (range.start > position) {
                segments.push({ text: text.slice(position, range.start) });
            }

            segments.push({
                text: text.slice(range.start, range.end),
                className: range.className
            });
            position = range.end;
        }

        if (position < text.length) {
            segments.push({ text: text.slice(position) });
        }

        return segments.length > 0 ? segments : [{ text }];
    }
}

class TranscriptView extends TextFileView {
    data: string = '';
    cues: TranscriptCue[] = [];
    filteredCues: TranscriptCue[] = [];
    searchQuery: string = '';

    getViewType(): string {
        return TRANSCRIPT_VIEW_TYPE;
    }

    getDisplayText(): string {
        return this.file?.basename || 'Transcript';
    }

    getIcon(): string {
        return 'captions';
    }

    onOpen(): Promise<void> {
        this.contentEl.addClass('transcript-view-container');
        return Promise.resolve();
    }

    onClose(): Promise<void> {
        this.contentEl.empty();
        return Promise.resolve();
    }

    getViewData(): string {
        return this.data;
    }

    setViewData(data: string, _clear: boolean): void {
        this.data = data;
        this.cues = parseTranscript(data, this.getTranscriptFormat());
        this.applyFilters();
        this.renderTranscript();
    }

    clear(): void {
        this.data = '';
        this.cues = [];
        this.filteredCues = [];
        this.contentEl.empty();
    }

    getTranscriptFormat(): TranscriptFormat {
        return this.file?.extension?.toLowerCase() === 'srt' ? 'srt' : 'vtt';
    }

    applyFilters(): void {
        const query = this.searchQuery.toLowerCase();

        this.filteredCues = this.cues.filter((cue) => {
            if (!query) return true;

            return cue.text.toLowerCase().includes(query) ||
                cue.start.toLowerCase().includes(query) ||
                cue.end.toLowerCase().includes(query);
        });
    }

    renderTranscript(): void {
        this.contentEl.empty();

        const container = this.contentEl.createDiv({ cls: 'transcript-view-content' });
        const toolbar = container.createDiv({ cls: 'transcript-view-toolbar' });

        const searchInput = toolbar.createEl('input', {
            cls: 'transcript-view-search',
            attr: { type: 'text', placeholder: 'Filter transcript...' }
        });
        searchInput.value = this.searchQuery;

        const info = toolbar.createDiv({ cls: 'transcript-view-info' });
        const cueList = container.createDiv({ cls: 'transcript-cues' });

        searchInput.addEventListener('input', () => {
            this.searchQuery = searchInput.value;
            this.applyFilters();
            this.renderTranscriptCues(cueList, info);
        });

        this.renderTranscriptCues(cueList, info);
    }

    renderTranscriptCues(container: HTMLElement, info: HTMLElement): void {
        container.empty();

        if (this.filteredCues.length === 0) {
            container.createDiv({ cls: 'transcript-empty', text: 'No matching transcript cues' });
            info.textContent = `0 of ${this.cues.length.toLocaleString()} cues`;
            return;
        }

        info.textContent = `${this.filteredCues.length.toLocaleString()} of ${this.cues.length.toLocaleString()} cues`;

        for (const cue of this.filteredCues) {
            const cueEl = container.createDiv({ cls: 'transcript-cue' });
            const metaEl = cueEl.createDiv({ cls: 'transcript-cue-meta' });
            metaEl.createSpan({ cls: 'transcript-cue-number', text: String(cue.number) });
            metaEl.createSpan({ cls: 'transcript-cue-time', text: `${cue.start} -> ${cue.end}` });

            const textEl = cueEl.createDiv({ cls: 'transcript-cue-text' });
            this.renderTranscriptText(textEl, cue.text || ' ');
        }
    }

    renderTranscriptText(parent: HTMLElement, text: string): void {
        const lines = text.split('\n');

        lines.forEach((line, index) => {
            if (index > 0) {
                parent.createEl('br');
            }

            for (const segment of this.findTextMatches(line, this.searchQuery)) {
                if (segment.className) {
                    parent.createSpan({ text: segment.text, cls: segment.className });
                } else {
                    parent.appendText(segment.text);
                }
            }
        });
    }

    findTextMatches(text: string, query: string): { text: string, className?: string }[] {
        if (!query) return [{ text }];

        const segments: { text: string, className?: string }[] = [];
        const lowerText = text.toLowerCase();
        const lowerQuery = query.toLowerCase();
        let position = 0;
        let index = lowerText.indexOf(lowerQuery);

        while (index !== -1) {
            if (index > position) {
                segments.push({ text: text.slice(position, index) });
            }

            segments.push({
                text: text.slice(index, index + query.length),
                className: 'transcript-highlight'
            });
            position = index + query.length;
            index = lowerText.indexOf(lowerQuery, position);
        }

        if (position < text.length) {
            segments.push({ text: text.slice(position) });
        }

        return segments.length > 0 ? segments : [{ text }];
    }
}

class JsonView extends TextFileView {
    data: string = '';
    indentSize: number = 2;
    editorEl?: HTMLTextAreaElement;
    statusEl?: HTMLElement;

    getViewType(): string {
        return JSON_VIEW_TYPE;
    }

    getDisplayText(): string {
        return this.file?.basename || 'JSON';
    }

    getIcon(): string {
        return 'braces';
    }

    onOpen(): Promise<void> {
        this.contentEl.addClass('json-view-container');
        return Promise.resolve();
    }

    onClose(): Promise<void> {
        this.contentEl.empty();
        return Promise.resolve();
    }

    getViewData(): string {
        return this.editorEl?.value ?? this.data;
    }

    setViewData(data: string, _clear: boolean): void {
        this.data = data;
        this.renderJson();
    }

    clear(): void {
        this.data = '';
        this.contentEl.empty();
    }

    renderJson(): void {
        this.contentEl.empty();

        const container = this.contentEl.createDiv({ cls: 'json-view-content' });
        const toolbar = container.createDiv({ cls: 'json-view-toolbar' });

        const validateBtn = toolbar.createEl('button', {
            text: 'Validate',
            cls: 'json-action-btn'
        });

        const formatBtn = toolbar.createEl('button', {
            text: 'Format',
            cls: 'json-action-btn'
        });

        const minifyBtn = toolbar.createEl('button', {
            text: 'Minify',
            cls: 'json-action-btn'
        });

        const indentSelect = toolbar.createEl('select', {
            cls: 'json-indent-select',
            attr: { 'aria-label': 'JSON indentation size' }
        });
        indentSelect.createEl('option', { text: '2 Spaces', value: '2' });
        indentSelect.createEl('option', { text: '4 Spaces', value: '4' });
        indentSelect.value = String(this.indentSize);

        const status = toolbar.createDiv({ cls: 'json-view-info' });
        const editor = container.createEl('textarea', {
            cls: 'json-editor',
            attr: {
                'aria-label': 'JSON editor',
                autocapitalize: 'off',
                autocomplete: 'off',
                autocorrect: 'off',
                spellcheck: 'false',
                wrap: 'off'
            }
        });

        editor.value = this.data;
        this.editorEl = editor;
        this.statusEl = status;

        indentSelect.addEventListener('change', () => {
            this.indentSize = Number(indentSelect.value);
        });

        validateBtn.addEventListener('click', () => {
            const isValid = this.updateValidationStatus();
            new Notice(isValid ? 'JSON is valid.' : 'JSON needs a fix before formatting.');
        });

        formatBtn.addEventListener('click', () => {
            this.applyJsonTransform(formatJson(this.getViewData(), this.indentSize), 'JSON formatted.');
        });

        minifyBtn.addEventListener('click', () => {
            this.applyJsonTransform(minifyJson(this.getViewData()), 'JSON minified.');
        });

        editor.addEventListener('input', () => {
            this.data = editor.value;
            this.updateValidationStatus();
            this.requestSave();
        });

        this.updateValidationStatus();
    }

    applyJsonTransform(result: ReturnType<typeof formatJson>, successNotice: string): void {
        if (!result.success) {
            this.updateValidationStatus(result.error);
            new Notice('JSON needs a fix before formatting.');
            return;
        }

        this.data = result.text;
        if (this.editorEl) {
            this.editorEl.value = result.text;
            this.editorEl.focus();
        }
        this.updateValidationStatus();
        this.requestSave();
        new Notice(successNotice);
    }

    updateValidationStatus(errorOverride?: string): boolean {
        if (!this.statusEl) return false;

        if (errorOverride) {
            this.statusEl.setText(errorOverride);
            this.statusEl.removeClass('valid');
            this.statusEl.addClass('error');
            return false;
        }

        const result = validateJson(this.getViewData());
        if (result.valid) {
            this.statusEl.setText(result.summary);
            this.statusEl.removeClass('error');
            this.statusEl.addClass('valid');
            return true;
        }

        this.statusEl.setText(result.error);
        this.statusEl.removeClass('valid');
        this.statusEl.addClass('error');
        return false;
    }
}

class JsonlView extends TextFileView {
    data: string = '';
    entries: JsonlEntry[] = [];
    query: string = '';
    plugin: CSVViewerPlugin;
    renderToken: number = 0;
    debounceTimer: number = 0;

    constructor(leaf: WorkspaceLeaf, plugin: CSVViewerPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return JSONL_VIEW_TYPE;
    }

    getDisplayText(): string {
        return this.file?.basename || 'JSONL';
    }

    getIcon(): string {
        return 'list';
    }

    onOpen(): Promise<void> {
        this.contentEl.addClass('jsonl-view-container');
        return Promise.resolve();
    }

    onClose(): Promise<void> {
        window.clearTimeout(this.debounceTimer);
        this.contentEl.empty();
        return Promise.resolve();
    }

    getViewData(): string {
        return this.data;
    }

    setViewData(data: string, _clear: boolean): void {
        this.data = data;
        this.entries = parseJsonl(data);
        this.renderJsonl();
    }

    clear(): void {
        this.data = '';
        this.entries = [];
        this.contentEl.empty();
    }

    renderJsonl(): void {
        this.contentEl.empty();

        const container = this.contentEl.createDiv({ cls: 'jsonl-view-content' });
        const toolbar = container.createDiv({ cls: 'jsonl-view-toolbar' });

        const queryInput = toolbar.createEl('input', {
            cls: 'jsonl-view-query',
            attr: {
                type: 'text',
                placeholder: 'jq filter, e.g. select(.level == "error") | .msg',
                'aria-label': 'Jq filter',
                autocapitalize: 'off',
                autocomplete: 'off',
                autocorrect: 'off',
                spellcheck: 'false'
            }
        });
        queryInput.value = this.query;

        const info = toolbar.createDiv({ cls: 'jsonl-view-info' });
        const body = container.createDiv({ cls: 'jsonl-lines' });

        const apply = () => {
            window.clearTimeout(this.debounceTimer);
            void this.renderBody(body, info);
        };

        queryInput.addEventListener('input', () => {
            this.query = queryInput.value;
            window.clearTimeout(this.debounceTimer);
            this.debounceTimer = window.setTimeout(apply, 250);
        });

        queryInput.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key === 'Enter') {
                apply();
            }
        });

        apply();
    }

    async renderBody(body: HTMLElement, info: HTMLElement): Promise<void> {
        const token = ++this.renderToken;
        const total = this.entries.length;
        body.empty();
        info.removeClass('error');

        if (!this.query.trim()) {
            info.setText(`${total.toLocaleString()} lines`);
            for (const entry of this.entries) {
                this.renderEntry(body, entry.number, entry.value, entry.error);
            }
            return;
        }

        let rows: { n: number, o: unknown }[];
        try {
            const jq = await this.plugin.getJq();
            if (token !== this.renderToken) return;
            rows = jq.json<{ n: number, o: unknown }>(tagEntries(this.entries), buildQuery(this.query));
        } catch (error) {
            if (token !== this.renderToken) return;
            info.setText(this.getJqErrorMessage(error));
            info.addClass('error');
            return;
        }

        if (token !== this.renderToken) return;

        info.setText(`${rows.length.toLocaleString()} results from ${total.toLocaleString()} lines`);

        if (rows.length === 0) {
            body.createDiv({ cls: 'jsonl-empty', text: 'No lines match this filter' });
            return;
        }

        for (const row of rows) {
            this.renderEntry(body, row.n, row.o);
        }
    }

    renderEntry(body: HTMLElement, lineNumber: number, value: unknown, error?: string): void {
        const row = body.createDiv({ cls: 'jsonl-entry' + (error ? ' invalid' : '') });
        row.createDiv({ cls: 'jsonl-line-number', text: String(lineNumber) });

        if (error) {
            row.createDiv({ cls: 'jsonl-error', text: `Invalid JSON: ${error}` });
            return;
        }

        row.createEl('pre', { cls: 'jsonl-json', text: formatJsonlValue(value) });
    }

    getJqErrorMessage(error: unknown): string {
        const stderr = (error as { stderr?: string } | null)?.stderr;
        const message = stderr || (error instanceof Error ? error.message : String(error));
        return message.replace(/^jq: error \(at <stdin>:\d+\):\s*/gm, '').trim();
    }
}

export default class CSVViewerPlugin extends Plugin {
    settings: CSVViewerSettings;
    jqPromise?: Promise<Jq>;

    getJq(): Promise<Jq> {
        if (!this.jqPromise) {
            this.jqPromise = loadJq();
        }
        return this.jqPromise;
    }

    async onload() {
        await this.loadSettings();

        this.registerView(CSV_VIEW_TYPE, (leaf) => new CSVView(leaf));
        this.registerView(LOG_VIEW_TYPE, (leaf) => new LogView(leaf));
        this.registerView(TRANSCRIPT_VIEW_TYPE, (leaf) => new TranscriptView(leaf));
        this.registerView(JSON_VIEW_TYPE, (leaf) => new JsonView(leaf));
        this.registerView(JSONL_VIEW_TYPE, (leaf) => new JsonlView(leaf, this));

        // Built-in extensions are claimed first, so a stale custom list cannot hijack a new format.
        const claimed = new Set<string>();
        const claim = (extensions: string[], viewType: string) => {
            const fresh = extensions.filter((ext) => !claimed.has(ext));
            fresh.forEach((ext) => claimed.add(ext));
            if (fresh.length > 0) {
                this.registerExtensions(fresh, viewType);
            }
        };

        VIEWERS.filter((viewer) => this.settings[viewer.enable]).forEach((viewer) => claim(viewer.extensions, viewer.viewType));
        VIEWERS.filter((viewer) => this.settings[viewer.enable]).forEach((viewer) => claim(parseExtensionList(this.settings.extraExtensions?.[viewer.key]), viewer.viewType));

        this.addSettingTab(new CSVViewerSettingTab(this.app, this));
    }

    async loadSettings(): Promise<void> {
        const savedSettings: unknown = await this.loadData();
        this.settings = {
            ...DEFAULT_SETTINGS,
            ...this.parseSettings(savedSettings)
        };
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    parseSettings(settings: unknown): Partial<CSVViewerSettings> {
        if (!settings || typeof settings !== 'object') {
            return {};
        }

        const candidate = settings as Partial<Record<keyof CSVViewerSettings, unknown>>;
        const savedExtensions = candidate.extraExtensions;
        const extraExtensions: Record<string, string> = {};

        if (savedExtensions && typeof savedExtensions === 'object') {
            for (const [key, value] of Object.entries(savedExtensions as Record<string, unknown>)) {
                if (typeof value === 'string') {
                    extraExtensions[key] = value;
                }
            }
        }

        return {
            extraExtensions,
            ...(typeof candidate.enableCsvViewer === 'boolean' ? { enableCsvViewer: candidate.enableCsvViewer } : {}),
            ...(typeof candidate.enableLogViewer === 'boolean' ? { enableLogViewer: candidate.enableLogViewer } : {}),
            ...(typeof candidate.enableVttViewer === 'boolean' ? { enableVttViewer: candidate.enableVttViewer } : {}),
            ...(typeof candidate.enableSrtViewer === 'boolean' ? { enableSrtViewer: candidate.enableSrtViewer } : {}),
            ...(typeof candidate.enableJsonViewer === 'boolean' ? { enableJsonViewer: candidate.enableJsonViewer } : {}),
            ...(typeof candidate.enableJsonlViewer === 'boolean' ? { enableJsonlViewer: candidate.enableJsonlViewer } : {})
        };
    }
}

class CSVViewerSettingTab extends PluginSettingTab {
    plugin: CSVViewerPlugin;

    constructor(app: App, plugin: CSVViewerPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        for (const viewer of VIEWERS) {
            new Setting(containerEl)
                .setName(viewer.name)
                .setDesc(viewer.desc)
                .addToggle((toggle) => toggle
                    .setValue(this.plugin.settings[viewer.enable])
                    .onChange(async (value) => {
                        this.plugin.settings[viewer.enable] = value;
                        await this.plugin.saveSettings();
                        new Notice('Reload this plugin for file type changes to take effect.');
                    }))
                .addText((text) => text
                    .setPlaceholder('Additional extensions (comma-separated)')
                    .setValue(this.plugin.settings.extraExtensions?.[viewer.key] ?? '')
                    .onChange(async (value) => {
                        this.plugin.settings.extraExtensions = {
                            ...this.plugin.settings.extraExtensions,
                            [viewer.key]: value
                        };
                        await this.plugin.saveSettings();
                        new Notice('Reload this plugin for file type changes to take effect.');
                    }));
        }

        new Setting(containerEl)
            .setName('Feedback')
            .setDesc('Report a bug or suggest a feature on GitHub.')
            .addButton((button) => button
                .setButtonText('Open issues')
                .onClick(() => {
                    window.open(SUPPORT_ISSUES_URL);
                }));
    }
}
