// SPDX-License-Identifier: GPL-3.0-only

export function tokenize(code, baseOffset, tokens, dispatcher) {
    const lines = code.split('\n');
    let offset = baseOffset;

    for (const line of lines) {
        const lineLen = line.length;

        // Headers: # Heading 1, ## Heading 2 ... ###### Heading 6
        const headerMatch = /^[ ]{0,3}(#{1,6})\s+/.exec(line);
        if (headerMatch) {
            const prefixLen = headerMatch[0].length;
            const level = headerMatch[1].length;
            tokens.push({
                type: 'markdown-header-prefix',
                start: offset,
                end: offset + prefixLen,
                level,
            });
            tokens.push({
                type: 'markdown-header',
                start: offset + prefixLen,
                end: offset + lineLen,
                level,
            });
            offset += lineLen + 1;
            continue;
        }

        // Horizontal rule: ---, ***, ___, or ────
        if (/^[ \t]*([*\-_─―—]){3,}[ \t]*$/.test(line)) {
            tokens.push({type: 'markdown-hr', start: offset, end: offset + lineLen});
            offset += lineLen + 1;
            continue;
        }

        // Blockquotes: > quote
        if (line.startsWith('>')) {
            tokens.push({type: 'markdown-quote', start: offset, end: offset + lineLen});
            offset += lineLen + 1;
            continue;
        }

        // Checklists: - [ ] item, - [x] item
        const taskMatch = /^[ \t]*([-*+]|\d+\.)\s+\[([ xX])\]\s+/.exec(line);
        if (taskMatch) {
            tokens.push({type: 'markdown-list', start: offset, end: offset + taskMatch[0].length});
            if (taskMatch[2].toLowerCase() === 'x') {
                tokens.push({type: 'markdown-done', start: offset + taskMatch[0].length, end: offset + lineLen});
            }
        } else {
            // Lists: - item, * item, 1. item
            const listMatch = /^[ \t]*([-*+]|\d+\.)\s+/.exec(line);
            if (listMatch) {
                tokens.push({type: 'markdown-list', start: offset, end: offset + listMatch[0].length});
            }
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

            // Strikethrough: ~~strikethrough~~
            if (line.startsWith('~~', col)) {
                const endStrike = line.indexOf('~~', col + 2);
                if (endStrike !== -1) {
                    tokens.push({type: 'markdown-strikethrough', start: offset + col, end: offset + endStrike + 2});
                    col = endStrike + 2;
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
