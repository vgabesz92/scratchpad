// SPDX-License-Identifier: GPL-3.0-only

export function tokenize(code, baseOffset, tokens, dispatcher) {
    const lines = code.split('\n');
    let offset = baseOffset;

    for (const line of lines) {
        const lineLen = line.length;

        // Headers: # Heading 1, ## Heading 2
        const headerMatch = /^#{1,6}\s+/.exec(line);
        if (headerMatch) {
            tokens.push({type: 'markdown-header', start: offset, end: offset + lineLen});
            offset += lineLen + 1;
            continue;
        }

        // Blockquotes: > quote
        if (line.startsWith('>')) {
            tokens.push({type: 'markdown-quote', start: offset, end: offset + lineLen});
            offset += lineLen + 1;
            continue;
        }

        // Lists: - item, * item, 1. item
        const listMatch = /^[ \t]*([-*+]|\d+\.)\s+/.exec(line);
        if (listMatch) {
            tokens.push({type: 'markdown-list', start: offset, end: offset + listMatch[0].length});
        }

        // Horizontal rule: ---, ***, ___
        if (/^[ \t]*([*-_]){3,}[ \t]*$/.test(line)) {
            tokens.push({type: 'punctuation', start: offset, end: offset + lineLen});
            offset += lineLen + 1;
            continue;
        }

        // Inline formatting in the line: **bold**, *italic*, `code`, [link](url)
        let col = 0;
        while (col < lineLen) {
            // Inline code: `code`
            if (line[col] === '`') {
                const endCode = line.indexOf('`', col + 1);
                if (endCode !== -1) {
                    tokens.push({type: 'string', start: offset + col, end: offset + endCode + 1});
                    col = endCode + 1;
                    continue;
                }
            }

            // Bold: **bold** or __bold__
            if (line.startsWith('**', col) || line.startsWith('__', col)) {
                const mark = line.slice(col, col + 2);
                const endBold = line.indexOf(mark, col + 2);
                if (endBold !== -1) {
                    tokens.push({type: 'markdown-bold', start: offset + col, end: offset + endBold + 2});
                    col = endBold + 2;
                    continue;
                }
            }

            // Italic: *italic* or _italic_
            if ((line[col] === '*' || line[col] === '_') && col + 1 < lineLen && line[col + 1] !== ' ') {
                const mark = line[col];
                const endItalic = line.indexOf(mark, col + 1);
                if (endItalic !== -1) {
                    tokens.push({type: 'markdown-italic', start: offset + col, end: offset + endItalic + 1});
                    col = endItalic + 1;
                    continue;
                }
            }

            // Link: [text](url)
            if (line[col] === '[') {
                const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)/.exec(line.slice(col));
                if (linkMatch) {
                    tokens.push({type: 'attribute', start: offset + col, end: offset + col + linkMatch[1].length + 2});
                    tokens.push({type: 'markdown-link', start: offset + col + linkMatch[1].length + 2, end: offset + col + linkMatch[0].length});
                    col += linkMatch[0].length;
                    continue;
                }
            }

            col++;
        }

        offset += lineLen + 1;
    }
}
