// SPDX-License-Identifier: GPL-3.0-only

const SQL_KEYWORDS = new Set([
    'select', 'from', 'where', 'insert', 'into', 'update', 'delete', 'join',
    'left', 'right', 'inner', 'outer', 'cross', 'full', 'on', 'group', 'by',
    'having', 'order', 'asc', 'desc', 'limit', 'offset', 'create', 'table',
    'drop', 'alter', 'add', 'index', 'primary', 'key', 'foreign', 'references',
    'and', 'or', 'not', 'in', 'is', 'null', 'like', 'ilike', 'union', 'all', 'as',
    'distinct', 'view', 'trigger', 'database', 'default', 'check', 'values',
    'set', 'between', 'exists', 'case', 'when', 'then', 'else', 'end',
    'with', 'over', 'partition', 'row_number', 'rank', 'dense_rank', 'begin',
    'commit', 'rollback', 'transaction', 'procedure', 'function', 'returns',
    'declare', 'exec', 'execute', 'grant', 'revoke', 'schema', 'column',
    'constraint', 'cascade', 'unique', 'auto_increment', 'identity', 'replace',
    'truncate', 'fetch', 'next', 'rows', 'only', 'returning', 'conflict', 'do', 'nothing'
]);

const SQL_TYPES = new Set([
    'int', 'integer', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric', 'float',
    'double', 'real', 'boolean', 'bool', 'char', 'varchar', 'text', 'blob', 'date',
    'time', 'datetime', 'timestamp', 'json', 'jsonb', 'uuid', 'serial', 'bigserial'
]);

const SQL_FUNCTIONS = new Set([
    'count', 'sum', 'avg', 'min', 'max', 'coalesce', 'nullif', 'concat',
    'substring', 'trim', 'lower', 'upper', 'now', 'cast', 'convert',
    'current_timestamp', 'current_date'
]);

export function tokenize(code, baseOffset, tokens, dispatcher) {
    const len = code.length;
    let i = 0;

    while (i < len) {
        // Line comment: -- ...
        if (code.startsWith('--', i)) {
            const end = code.indexOf('\n', i + 2);
            const tokenEnd = end === -1 ? len : end;
            tokens.push({type: 'comment', start: baseOffset + i, end: baseOffset + tokenEnd});
            i = tokenEnd;
            continue;
        }
        // Block comment: /* ... */
        if (code.startsWith('/*', i)) {
            const end = code.indexOf('*/', i + 2);
            const tokenEnd = end === -1 ? len : end + 2;
            tokens.push({type: 'comment', start: baseOffset + i, end: baseOffset + tokenEnd});
            i = tokenEnd;
            continue;
        }

        // Strings: '', ""
        if (code[i] === "'" || code[i] === '"') {
            const q = code[i];
            let j = i + 1;
            while (j < len) {
                if (code[j] === '\\') j += 2;
                else if (code[j] === q) { j++; break; }
                else j++;
            }
            tokens.push({type: 'string', start: baseOffset + i, end: baseOffset + j});
            i = j;
            continue;
        }

        // Numbers: 123, 123.45
        if (/\d/.test(code[i])) {
            const numMatch = /^\d+(\.\d+)?/.exec(code.slice(i));
            if (numMatch) {
                tokens.push({type: 'number', start: baseOffset + i, end: baseOffset + i + numMatch[0].length});
                i += numMatch[0].length;
                continue;
            }
        }

        // Identifiers: keywords, types, functions
        if (/[a-zA-Z_]/.test(code[i])) {
            const wordMatch = /^[a-zA-Z0-9_]+/.exec(code.slice(i));
            if (wordMatch) {
                const word = wordMatch[0];
                const lower = word.toLowerCase();
                const start = baseOffset + i;
                const end = start + word.length;
                i += word.length;

                if (SQL_KEYWORDS.has(lower)) {
                    tokens.push({type: 'keyword', start, end});
                } else if (SQL_TYPES.has(lower)) {
                    tokens.push({type: 'type', start, end});
                } else if (SQL_FUNCTIONS.has(lower)) {
                    tokens.push({type: 'function', start, end});
                } else {
                    let next = i;
                    while (next < len && /\s/.test(code[next]))
                        next++;
                    if (next < len && code[next] === '(')
                        tokens.push({type: 'function', start, end});
                }
                continue;
            }
        }

        if (/[(),;.*=<>!+-]/.test(code[i])) {
            tokens.push({type: 'punctuation', start: baseOffset + i, end: baseOffset + i + 1});
            i++;
            continue;
        }

        i++;
    }
}
