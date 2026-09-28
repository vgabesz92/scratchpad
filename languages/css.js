// SPDX-License-Identifier: GPL-3.0-only

const CSS_KEYWORDS = new Set([
    'block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'inline-grid', 'flow-root',
    'contents', 'none', 'table', 'table-row', 'table-cell', 'list-item',
    'border-box', 'content-box',
    'row', 'column', 'row-reverse', 'column-reverse', 'wrap', 'nowrap', 'wrap-reverse',
    'space-between', 'space-around', 'space-evenly', 'stretch', 'center', 'start', 'end',
    'flex-start', 'flex-end', 'self-start', 'self-end', 'baseline', 'auto', 'dense',
    'static', 'relative', 'absolute', 'fixed', 'sticky',
    'hidden', 'visible', 'scroll', 'clip', 'collapse',
    'bold', 'normal', 'italic', 'oblique', 'bolder', 'lighter',
    'underline', 'line-through', 'overline',
    'uppercase', 'lowercase', 'capitalize',
    'left', 'right', 'justify',
    'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
    'break-word', 'break-all', 'keep-all', 'ellipsis',
    'solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset',
    'pointer', 'default', 'crosshair', 'move', 'text', 'wait', 'help', 'not-allowed',
    'grab', 'grabbing', 'zoom-in', 'zoom-out',
    'inherit', 'initial', 'unset', 'revert', 'revert-layer',
    'transparent', 'currentcolor',
    'cover', 'contain', 'repeat', 'no-repeat', 'repeat-x', 'repeat-y',
    'ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear', 'step-start', 'step-end',
    'infinite', 'forwards', 'backwards', 'both', 'paused', 'running', 'all'
]);

const CSS_COLORS = new Set([
    'red', 'blue', 'green', 'white', 'black', 'gray', 'grey', 'yellow', 'orange', 'purple',
    'pink', 'cyan', 'magenta', 'lime', 'navy', 'teal', 'aqua', 'fuchsia', 'maroon', 'olive',
    'silver', 'gold', 'coral', 'salmon', 'tomato', 'khaki', 'plum', 'indigo', 'violet',
    'crimson', 'azure', 'beige', 'brown'
]);

export function tokenize(code, baseOffset, tokens, dispatcher, inlineMode = false) {
    const len = code.length;
    let i = 0;
    if (!inlineMode && !code.includes('{') && code.includes(':'))
        inlineMode = true;

    let braceDepth = inlineMode ? 1 : 0;
    let inDeclarationValue = false;
    let parenDepth = 0;

    while (i < len) {
        // Comments
        if (code.startsWith('/*', i)) {
            const end = code.indexOf('*/', i + 2);
            const tokenEnd = end === -1 ? len : end + 2;
            tokens.push({type: 'comment', start: baseOffset + i, end: baseOffset + tokenEnd});
            i = tokenEnd;
            continue;
        }
        if (code.startsWith('//', i)) {
            const end = code.indexOf('\n', i + 2);
            const tokenEnd = end === -1 ? len : end;
            tokens.push({type: 'comment', start: baseOffset + i, end: baseOffset + tokenEnd});
            i = tokenEnd;
            continue;
        }

        // Strings: "", ''
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

        // At-rules: @media, @keyframes, @import etc.
        if (code[i] === '@') {
            const atMatch = /^@[a-zA-Z-]+/.exec(code.slice(i));
            if (atMatch) {
                tokens.push({type: 'keyword', start: baseOffset + i, end: baseOffset + i + atMatch[0].length});
                i += atMatch[0].length;
                continue;
            }
        }

        // Hex colors: #fff, #1e1e1e (only inside values or after :)
        if (code[i] === '#' && (inDeclarationValue || parenDepth > 0) && i + 1 < len && /[0-9a-fA-F]/.test(code[i + 1])) {
            const hexMatch = /^#[0-9a-fA-F]{3,8}\b/.exec(code.slice(i));
            if (hexMatch) {
                tokens.push({type: 'number', start: baseOffset + i, end: baseOffset + i + hexMatch[0].length});
                i += hexMatch[0].length;
                continue;
            }
        }

        // ID Selector: #main, #header
        if (code[i] === '#' && !inDeclarationValue && parenDepth === 0 && i + 1 < len && /[a-zA-Z_-]/.test(code[i + 1])) {
            const idMatch = /^#[a-zA-Z0-9_-]+/.exec(code.slice(i));
            if (idMatch) {
                tokens.push({type: 'css-selector', start: baseOffset + i, end: baseOffset + i + idMatch[0].length});
                i += idMatch[0].length;
                continue;
            }
        }

        // Numbers with units or unitless numbers: 10px, 1.5rem, 100%, 0.3s, .83, 172
        const numMatch = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:px|em|rem|%|vh|vw|vmin|vmax|dvh|dvw|svh|svw|lvh|lvw|cqw|cqh|cqi|cqb|cqmin|cqmax|pt|pc|in|cm|mm|s|ms|deg|rad|turn|fr|ch|ex|cap|ic|lh|rlh|dpi|dpcm|dppx|x|Hz|kHz)?\b/i.exec(code.slice(i));
        if ((inDeclarationValue || parenDepth > 0) && numMatch && numMatch[0].length > 0) {
            tokens.push({type: 'number', start: baseOffset + i, end: baseOffset + i + numMatch[0].length});
            i += numMatch[0].length;
            continue;
        }

        // Class Selector: .btn, .card-title
        if (code[i] === '.' && !inDeclarationValue && parenDepth === 0 && i + 1 < len && /[a-zA-Z_-]/.test(code[i + 1])) {
            const classMatch = /^\.[a-zA-Z0-9_-]+/.exec(code.slice(i));
            if (classMatch) {
                tokens.push({type: 'css-selector', start: baseOffset + i, end: baseOffset + i + classMatch[0].length});
                i += classMatch[0].length;
                continue;
            }
        }

        // Pseudo-classes / pseudo-elements: :hover, ::after
        if (code[i] === ':' && !inDeclarationValue && parenDepth === 0 && i + 1 < len && (code[i + 1] === ':' || /[a-zA-Z-]/.test(code[i + 1]))) {
            const pseudoMatch = /^:{1,2}[a-zA-Z-]+(?:\([^)]*\))?/.exec(code.slice(i));
            if (pseudoMatch) {
                tokens.push({type: 'css-selector', start: baseOffset + i, end: baseOffset + i + pseudoMatch[0].length});
                i += pseudoMatch[0].length;
                continue;
            }
        }

        // !important
        if (code.startsWith('!important', i)) {
            tokens.push({type: 'keyword', start: baseOffset + i, end: baseOffset + i + 10});
            i += 10;
            continue;
        }

        // CSS Variables: --var-name
        if (code.startsWith('--', i)) {
            const varMatch = /^--[a-zA-Z0-9_-]+/.exec(code.slice(i));
            if (varMatch) {
                tokens.push({type: 'bash-var', start: baseOffset + i, end: baseOffset + i + varMatch[0].length});
                i += varMatch[0].length;
                continue;
            }
        }

        // Words: Properties or Values or Tag Selectors
        if (/[a-zA-Z_-]/.test(code[i])) {
            const wordMatch = /^[a-zA-Z0-9_-]+/.exec(code.slice(i));
            if (wordMatch) {
                const word = wordMatch[0];
                const start = baseOffset + i;
                const end = start + word.length;
                i += word.length;

                let next = i;
                while (next < len && /\s/.test(code[next]))
                    next++;

                if (!inDeclarationValue && (braceDepth > 0 || inlineMode) && next < len && code[next] === ':') {
                    // CSS Property
                    tokens.push({type: 'css-property', start, end});
                } else if (inDeclarationValue || parenDepth > 0) {
                    // Value keyword or function
                    if (next < len && code[next] === '(') {
                        tokens.push({type: 'function', start, end});
                    } else {
                        const lower = word.toLowerCase();
                        if (CSS_KEYWORDS.has(lower)) {
                            tokens.push({type: 'keyword', start, end});
                        } else if (CSS_COLORS.has(lower)) {
                            tokens.push({type: 'number', start, end});
                        }
                    }
                } else if (braceDepth === 0 || (next < len && (code[next] === '{' || code[next] === ',' || code[next] === '>'))) {
                    // Tag selector: body, div, span, p, a, etc.
                    tokens.push({type: 'css-selector', start, end});
                }
                continue;
            }
        }

        // Structure punctuation
        if (code[i] === '{') {
            braceDepth++;
            inDeclarationValue = false;
            tokens.push({type: 'punctuation', start: baseOffset + i, end: baseOffset + i + 1});
            i++;
            continue;
        }
        if (code[i] === '}') {
            braceDepth = Math.max(0, braceDepth - 1);
            inDeclarationValue = false;
            tokens.push({type: 'punctuation', start: baseOffset + i, end: baseOffset + i + 1});
            i++;
            continue;
        }
        if (code[i] === ':') {
            if (braceDepth > 0 || inlineMode)
                inDeclarationValue = true;
            tokens.push({type: 'punctuation', start: baseOffset + i, end: baseOffset + i + 1});
            i++;
            continue;
        }
        if (code[i] === ';') {
            inDeclarationValue = false;
            tokens.push({type: 'punctuation', start: baseOffset + i, end: baseOffset + i + 1});
            i++;
            continue;
        }
        if (code[i] === '(') {
            parenDepth++;
            tokens.push({type: 'punctuation', start: baseOffset + i, end: baseOffset + i + 1});
            i++;
            continue;
        }
        if (code[i] === ')') {
            parenDepth = Math.max(0, parenDepth - 1);
            tokens.push({type: 'punctuation', start: baseOffset + i, end: baseOffset + i + 1});
            i++;
            continue;
        }
        if (/[,/]/.test(code[i])) {
            tokens.push({type: 'punctuation', start: baseOffset + i, end: baseOffset + i + 1});
            i++;
            continue;
        }
        if ((inDeclarationValue || parenDepth > 0) && /[+*]/.test(code[i])) {
            tokens.push({type: 'operator', start: baseOffset + i, end: baseOffset + i + 1});
            i++;
            continue;
        }

        i++;
    }
}

export function tokenizeInline(code, baseOffset, tokens, dispatcher) {
    return tokenize(code, baseOffset, tokens, dispatcher, true);
}
