// SPDX-License-Identifier: GPL-3.0-only

export function tokenize(code, baseOffset, tokens, dispatcher) {
    const len = code.length;
    let i = 0;

    while (i < len) {
        // Comment: # ...
        if (code[i] === '#') {
            const end = code.indexOf('\n', i + 1);
            const tokenEnd = end === -1 ? len : end;
            tokens.push({type: 'comment', start: baseOffset + i, end: baseOffset + tokenEnd});
            i = tokenEnd;
            continue;
        }

        // Document markers: ---, ...
        if ((code.startsWith('---', i) || code.startsWith('...', i)) && (i === 0 || code[i - 1] === '\n')) {
            tokens.push({type: 'punctuation', start: baseOffset + i, end: baseOffset + i + 3});
            i += 3;
            continue;
        }

        // Strings
        if (code[i] === '"' || code[i] === "'") {
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

        // Key: key:
        const keyMatch = /^[a-zA-Z0-9_.-]+\s*(?=:)/.exec(code.slice(i));
        if (keyMatch) {
            tokens.push({type: 'attribute', start: baseOffset + i, end: baseOffset + i + keyMatch[0].length});
            i += keyMatch[0].length;
            continue;
        }

        // Numbers: 123, -123.45
        if (/\d/.test(code[i]) || (code[i] === '-' && i + 1 < len && /\d/.test(code[i + 1]))) {
            const numMatch = /^-?\d+(\.\d+)?/.exec(code.slice(i));
            if (numMatch) {
                tokens.push({type: 'number', start: baseOffset + i, end: baseOffset + i + numMatch[0].length});
                i += numMatch[0].length;
                continue;
            }
        }

        // Booleans & Literals
        if (/[a-zA-Z]/.test(code[i])) {
            const wordMatch = /^[a-zA-Z0-9_.-]+/.exec(code.slice(i));
            if (wordMatch) {
                const word = wordMatch[0];
                const start = baseOffset + i;
                const end = start + word.length;
                i += word.length;
                if (/^(true|false|yes|no|on|off|null)$/i.test(word))
                    tokens.push({type: 'boolean', start, end});
                else
                    tokens.push({type: 'string', start, end});
                continue;
            }
        }

        // List item dash: - item
        if (code[i] === '-' && i + 1 < len && code[i + 1] === ' ') {
            tokens.push({type: 'punctuation', start: baseOffset + i, end: baseOffset + i + 1});
            i++;
            continue;
        }

        if (/[:\-[\]{}]/.test(code[i])) {
            tokens.push({type: 'punctuation', start: baseOffset + i, end: baseOffset + i + 1});
            i++;
            continue;
        }

        i++;
    }
}
