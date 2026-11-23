import { App, Notice, Plugin, PluginSettingTab, Setting, TextFileView } from 'obsidian';
import { applyCellEdit, getCellValue, parseCSV, parseTranscript, serializeCSV, sortCSVRows, TranscriptCue, TranscriptFormat } from './csv-parser';
import { formatJson, minifyJson, validateJson } from './json-utils';
import { SUPPORT_ISSUES_URL } from './support';

const CSV_VIEW_TYPE = 'csv-view';
const LOG_VIEW_TYPE = 'log-view';
const TRANSCRIPT_VIEW_TYPE = 'transcript-view';
const JSON_VIEW_TYPE = 'json-view';

interface CSVViewerSettings {
    enableCsvViewer: boolean;
    enableLogViewer: boolean;
    enableVttViewer: boolean;
    enableSrtViewer: boolean;
    enableJsonViewer: boolean;
}

const DEFAULT_SETTINGS: CSVViewerSettings = {
    enableCsvViewer: true,
    enableLogViewer: true,
    enableVttViewer: true,
    enableSrtViewer: true,
    enableJsonViewer: true
};

type LogLevel = 'error' | 'warning' | 'info' | 'debug' | 'default';

interface LogLine {
    number: number;
    text: string;
    level: LogLevel;
}

/**
 * Paste handler for editable cells: inserts the clipboard as plain text,
 * dropping any rich formatting.
 */
function pastePlainText(e: ClipboardEvent, td: HTMLElement): void {
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
        return sortCSVRows(this.parsedRows, this.sortColumn, this.sortAscending);
    }

    /**
     * Wire up editing for one body cell. Used by both Edit mode (every cell is
     * editable) and double-click editing (one cell at a time, no re-render).
     * Enter and blur save, Escape restores the stored value and saves nothing.
     * The stored value is always read from parsedRows, never captured at render
     * time, so a second edit of the same cell compares against what was saved.
     */
    bindCellEditor(td: HTMLElement, rowIndex: number, colIndex: number, tbody: HTMLElement): { start: () => void } {
        const storedValue = () => getCellValue(this.parsedRows, rowIndex, colIndex);

        td.addEventListener('paste', (e: ClipboardEvent) => pastePlainText(e, td));

        td.addEventListener('blur', () => {
            const newValue = td.textContent || '';
            if (applyCellEdit(this.parsedRows, rowIndex, colIndex, newValue)) {
                this.data = serializeCSV(this.parsedRows);
                this.requestSave();
            }

            if (!this.editMode) {
                td.removeAttribute('contenteditable');
                td.setAttribute('title', storedValue());
            }
        });

        td.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.isComposing) return;

            if (e.key === 'Enter') {
                e.preventDefault();
                td.blur();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                td.textContent = storedValue();
                td.blur();
            } else if (e.key === 'Tab' && this.editMode) {
                e.preventDefault();
                const allCells = Array.from(tbody.querySelectorAll('td[contenteditable]'));
                const currentIndex = allCells.indexOf(td);
                const nextIndex = e.shiftKey ? currentIndex - 1 : currentIndex + 1;
                if (nextIndex >= 0 && nextIndex < allCells.length) {
                    (allCells[nextIndex] as HTMLElement).focus();
                }
            }
        });

        return {
            start: () => {
                if (td.getAttribute('contenteditable') === 'true') return;

                td.setAttribute('contenteditable', 'true');
                td.removeAttribute('title');
                td.focus();

                const selection = window.getSelection();
                if (selection) {
                    const range = td.ownerDocument.createRange();
                    range.selectNodeContents(td);
                    range.collapse(false);
                    selection.removeAllRanges();
                    selection.addRange(range);
                }
            }
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
                    // Use contenteditable="true" for broad Obsidian/Electron compatibility.
                    this.bindCellEditor(td, originalRowIndex, j, tbody);
                    td.setAttribute('contenteditable', 'true');
                    td.removeAttribute('title');
                } else {
                    // Read mode: no per-cell listeners. A single delegated dblclick
                    // handler on the tbody finds the cell by these attributes.
                    td.dataset.row = String(originalRowIndex);
                    td.dataset.col = String(j);
                }
            }
        }

        if (!this.editMode) {
            // Editors are bound lazily, once per cell, the first time it is double-clicked.
            const editors = new WeakMap<HTMLElement, { start: () => void }>();
            tbody.addEventListener('dblclick', (e: MouseEvent) => {
                const td = (e.target as HTMLElement).closest<HTMLElement>('td');
                if (!td || !tbody.contains(td) || td.dataset.row === undefined || td.dataset.col === undefined) return;

                let editor = editors.get(td);
                if (!editor) {
                    editor = this.bindCellEditor(td, Number(td.dataset.row), Number(td.dataset.col), tbody);
                    editors.set(td, editor);
                }
                editor.start();
            });
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

export default class CSVViewerPlugin extends Plugin {
    settings: CSVViewerSettings;

    async onload() {
        await this.loadSettings();

        this.registerView(CSV_VIEW_TYPE, (leaf) => new CSVView(leaf));
        this.registerView(LOG_VIEW_TYPE, (leaf) => new LogView(leaf));
        this.registerView(TRANSCRIPT_VIEW_TYPE, (leaf) => new TranscriptView(leaf));
        this.registerView(JSON_VIEW_TYPE, (leaf) => new JsonView(leaf));

        if (this.settings.enableCsvViewer) {
            this.registerExtensions(['csv'], CSV_VIEW_TYPE);
        }

        if (this.settings.enableLogViewer) {
            this.registerExtensions(['log'], LOG_VIEW_TYPE);
        }

        if (this.settings.enableVttViewer) {
            this.registerExtensions(['vtt'], TRANSCRIPT_VIEW_TYPE);
        }

        if (this.settings.enableSrtViewer) {
            this.registerExtensions(['srt'], TRANSCRIPT_VIEW_TYPE);
        }

        if (this.settings.enableJsonViewer) {
            this.registerExtensions(['json'], JSON_VIEW_TYPE);
        }

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
        return {
            ...(typeof candidate.enableCsvViewer === 'boolean' ? { enableCsvViewer: candidate.enableCsvViewer } : {}),
            ...(typeof candidate.enableLogViewer === 'boolean' ? { enableLogViewer: candidate.enableLogViewer } : {}),
            ...(typeof candidate.enableVttViewer === 'boolean' ? { enableVttViewer: candidate.enableVttViewer } : {}),
            ...(typeof candidate.enableSrtViewer === 'boolean' ? { enableSrtViewer: candidate.enableSrtViewer } : {}),
            ...(typeof candidate.enableJsonViewer === 'boolean' ? { enableJsonViewer: candidate.enableJsonViewer } : {})
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

        new Setting(containerEl)
            .setName('CSV viewer')
            .setDesc('Open .csv files in the interactive table viewer.')
            .addToggle((toggle) => toggle
                .setValue(this.plugin.settings.enableCsvViewer)
                .onChange(async (value) => {
                    this.plugin.settings.enableCsvViewer = value;
                    await this.plugin.saveSettings();
                    new Notice('Reload this plugin for file type changes to take effect.');
                }));

        new Setting(containerEl)
            .setName('Log viewer')
            .setDesc('Open .log files in the filtered log viewer.')
            .addToggle((toggle) => toggle
                .setValue(this.plugin.settings.enableLogViewer)
                .onChange(async (value) => {
                    this.plugin.settings.enableLogViewer = value;
                    await this.plugin.saveSettings();
                    new Notice('Reload this plugin for file type changes to take effect.');
                }));

        new Setting(containerEl)
            .setName('.vtt transcript viewer')
            .setDesc('Open .vtt files in the transcript viewer.')
            .addToggle((toggle) => toggle
                .setValue(this.plugin.settings.enableVttViewer)
                .onChange(async (value) => {
                    this.plugin.settings.enableVttViewer = value;
                    await this.plugin.saveSettings();
                    new Notice('Reload this plugin for file type changes to take effect.');
                }));

        new Setting(containerEl)
            .setName('.srt transcript viewer')
            .setDesc('Open .srt files in the transcript viewer.')
            .addToggle((toggle) => toggle
                .setValue(this.plugin.settings.enableSrtViewer)
                .onChange(async (value) => {
                    this.plugin.settings.enableSrtViewer = value;
                    await this.plugin.saveSettings();
                    new Notice('Reload this plugin for file type changes to take effect.');
                }));

        new Setting(containerEl)
            .setName('JSON viewer')
            .setDesc('Open .json files in an editable JSON viewer with validation and formatting controls.')
            .addToggle((toggle) => toggle
                .setValue(this.plugin.settings.enableJsonViewer)
                .onChange(async (value) => {
                    this.plugin.settings.enableJsonViewer = value;
                    await this.plugin.saveSettings();
                    new Notice('Reload this plugin for file type changes to take effect.');
                }));

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
