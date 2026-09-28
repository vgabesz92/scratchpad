// SPDX-License-Identifier: GPL-3.0-only

export function tokenize(code, baseOffset, tokens, dispatcher) {
    const lines = code.split('\n');
    let offset = baseOffset;

    for (const line of lines) {
        const lineLen = line.length;
        if (line.startsWith('+') && !line.startsWith('+++'))
            tokens.push({type: 'diff-add', start: offset, end: offset + lineLen});
        else if (line.startsWith('-') && !line.startsWith('---'))
            tokens.push({type: 'diff-remove', start: offset, end: offset + lineLen});
        else if (line.startsWith('@@'))
            tokens.push({type: 'diff-meta', start: offset, end: offset + lineLen});
        else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++'))
            tokens.push({type: 'keyword', start: offset, end: offset + lineLen});
        offset += lineLen + 1;
    }
}
