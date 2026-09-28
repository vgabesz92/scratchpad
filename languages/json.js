// SPDX-License-Identifier: GPL-3.0-only

export function tokenize(code, baseOffset, tokens, dispatcher) {
    const len = code.length;
    let i = 0;

    while (i < len) {
        // Comments (JSONC/JSON5)
        if (code.startsWith('//', i)) {
            const end = code.indexOf('\n', i + 2);
            const tokenEnd = end === -1 ? len : end;
            tokens.push({type: 'comment', start: baseOffset + i, end: baseOffset + tokenEnd});
            i = tokenEnd;
            continue;
        }
        if (code.startsWith('/*', i)) {
            const end = code.indexOf('*/', i + 2);
            const tokenEnd = end === -1 ? len : end + 2;
            tokens.push({type: 'comment', start: baseOffset + i, end: baseOffset + tokenEnd});
            i = tokenEnd;
            continue;
        }

        // Strings: distinguishes keys ("key":) from string values
        if (code[i] === '"' || code[i] === "'") {
            const q = code[i];
            let j = i + 1;
            while (j < len) {
                if (code[j] === '\\') j += 2;
                else if (code[j] === q) { j++; break; }
                else j++;
            }
            let next = j;
            while (next < len && /\s/.test(code[next]))
                next++;
            if (next < len && code[next] === ':')
                tokens.push({type: 'attribute', start: baseOffset + i, end: baseOffset + j});
            else
                tokens.push({type: 'string', start: baseOffset + i, end: baseOffset + j});
            i = j;
            continue;
        }

        // Numbers: -123.45, 1e-5
        if (/\d/.test(code[i]) || (code[i] === '-' && i + 1 < len && /\d/.test(code[i + 1]))) {
            const numMatch = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(code.slice(i));
            if (numMatch) {
                tokens.push({type: 'number', start: baseOffset + i, end: baseOffset + i + numMatch[0].length});
                i += numMatch[0].length;
                continue;
            }
        }

        // Booleans & null
        if (/[a-zA-Z]/.test(code[i])) {
            const wordMatch = /^[a-zA-Z]+/.exec(code.slice(i));
            if (wordMatch) {
                const word = wordMatch[0];
                const start = baseOffset + i;
                const end = start + word.length;
                i += word.length;
                if (word === 'true' || word === 'false' || word === 'null')
                    tokens.push({type: 'boolean', start, end});
                continue;
            }
        }

        if (/[{}[\]:,]/.test(code[i])) {
            tokens.push({type: 'punctuation', start: baseOffset + i, end: baseOffset + i + 1});
            i++;
            continue;
        }

        i++;
    }
}
