// SPDX-License-Identifier: GPL-3.0-only

export function tokenize(code, baseOffset, tokens, dispatcher) {
    const len = code.length;
    let i = 0;

    while (i < len) {
        if (code[i] === '#' || code[i] === ';') {
            const end = code.indexOf('\n', i + 1);
            const tokenEnd = end === -1 ? len : end;
            tokens.push({type: 'comment', start: baseOffset + i, end: baseOffset + tokenEnd});
            i = tokenEnd;
            continue;
        }

        // Section header: [section] or [[table]] at line start
        const isLineStart = (i === 0 || code[i - 1] === '\n' || /^[ \t]*$/.test(code.slice(code.lastIndexOf('\n', i) + 1, i)));
        if (code[i] === '[' && isLineStart) {
            const end = code.indexOf(']', i);
            if (end !== -1 && !code.slice(i, end).includes(',')) {
                tokens.push({type: 'type', start: baseOffset + i, end: baseOffset + end + 1});
                i = end + 1;
                continue;
            }
        }

        // Strings
        if (code[i] === '"' || code[i] === "'") {
            const q = code[i];
            let j = i + 1;
            while (j < len && code[j] !== q) {
                if (code[j] === '\\') j += 2;
                else j++;
            }
            if (j < len) j++;
            tokens.push({type: 'string', start: baseOffset + i, end: baseOffset + j});
            i = j;
            continue;
        }

        // Key =
        const keyMatch = /^[a-zA-Z0-9_.-]+\s*(?==)/.exec(code.slice(i));
        if (keyMatch) {
            tokens.push({type: 'attribute', start: baseOffset + i, end: baseOffset + i + keyMatch[0].length});
            i += keyMatch[0].length;
            continue;
        }

        // Numbers / Dates
        if (/\d/.test(code[i])) {
            const numMatch = /^\d[0-9_.:T-]*(\.[0-9_]+)?/.exec(code.slice(i));
            if (numMatch) {
                tokens.push({type: 'number', start: baseOffset + i, end: baseOffset + i + numMatch[0].length});
                i += numMatch[0].length;
                continue;
            }
        }

        // Booleans
        if (/[a-zA-Z]/.test(code[i])) {
            const wordMatch = /^[a-zA-Z]+/.exec(code.slice(i));
            if (wordMatch) {
                const word = wordMatch[0];
                const start = baseOffset + i;
                const end = start + word.length;
                i += word.length;
                if (/^(true|false)$/i.test(word))
                    tokens.push({type: 'boolean', start, end});
                continue;
            }
        }

        if (/[=,[\]{}]/.test(code[i])) {
            tokens.push({type: 'operator', start: baseOffset + i, end: baseOffset + i + 1});
            i++;
            continue;
        }

        i++;
    }
}
