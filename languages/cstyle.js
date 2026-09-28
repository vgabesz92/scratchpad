// SPDX-License-Identifier: GPL-3.0-only
//
// Generic C-Style lexical tokenizer for Scratchpad.
// Shared by JavaScript, TypeScript, C, C++, C#, Java, Rust, and Go.

export function tokenizeCStyle(code, baseOffset, tokens, cfg, dispatcher) {
    const len = code.length;
    let i = 0;
    let canRegex = true;

    while (i < len) {
        // Line comment: //
        if (code.startsWith('//', i)) {
            const end = code.indexOf('\n', i + 2);
            const tokenEnd = end === -1 ? len : end;
            tokens.push({type: 'comment', start: baseOffset + i, end: baseOffset + tokenEnd});
            i = tokenEnd;
            canRegex = true;
            continue;
        }

        // Block comment: /* ... */
        if (code.startsWith('/*', i)) {
            const end = code.indexOf('*/', i + 2);
            const tokenEnd = end === -1 ? len : end + 2;
            tokens.push({type: 'comment', start: baseOffset + i, end: baseOffset + tokenEnd});
            i = tokenEnd;
            canRegex = true;
            continue;
        }

        // Preprocessor (C/C++ #include, #define etc.)
        if (cfg.hasPreprocessor && code[i] === '#' && (i === 0 || code[i - 1] === '\n' || /^\s*$/.test(code.slice(code.lastIndexOf('\n', i) + 1, i)))) {
            const prepMatch = /^#[ \t]*([a-zA-Z_]+)/.exec(code.slice(i));
            if (prepMatch) {
                tokens.push({type: 'doctype', start: baseOffset + i, end: baseOffset + i + prepMatch[0].length});
                i += prepMatch[0].length;

                // Check for header file after #include: <stdio.h> or "header.h"
                while (i < len && (code[i] === ' ' || code[i] === '\t'))
                    i++;
                if (i < len && (code[i] === '<' || code[i] === '"')) {
                    const closeChar = code[i] === '<' ? '>' : '"';
                    const endHead = code.indexOf(closeChar, i + 1);
                    const headEnd = endHead === -1 ? len : endHead + 1;
                    tokens.push({type: 'string', start: baseOffset + i, end: baseOffset + headEnd});
                    i = headEnd;
                }
                canRegex = true;
                continue;
            }
        }

        // Rust Attributes: #[derive(...)] or #![no_std]
        if (cfg.hasAttributes && (code.startsWith('#[', i) || code.startsWith('#![', i))) {
            const closeBracket = code.indexOf(']', i);
            const endPos = closeBracket === -1 ? len : closeBracket + 1;
            tokens.push({type: 'doctype', start: baseOffset + i, end: baseOffset + endPos});
            i = endPos;
            canRegex = true;
            continue;
        }

        // Decorators & Annotations (@decorator in JS/TS, Java @Override, C#)
        if ((cfg.hasDecorators || cfg.hasAttributes) && code[i] === '@' && i + 1 < len && /[a-zA-Z_$]/.test(code[i + 1])) {
            const decMatch = /^@[a-zA-Z0-9_$.]+/.exec(code.slice(i));
            if (decMatch) {
                tokens.push({type: 'function', start: baseOffset + i, end: baseOffset + i + decMatch[0].length});
                i += decMatch[0].length;
                canRegex = false;
                continue;
            }
        }

        // Rust Lifetimes vs char literal: 'a, 'static
        if (cfg.hasLifetimes && code[i] === "'" && i + 1 < len && /[a-zA-Z_]/.test(code[i + 1])) {
            const lifeMatch = /^'[a-zA-Z_][a-zA-Z0-9_]*/.exec(code.slice(i));
            if (lifeMatch && (i + lifeMatch[0].length >= len || code[i + lifeMatch[0].length] !== "'")) {
                tokens.push({type: 'type', start: baseOffset + i, end: baseOffset + i + lifeMatch[0].length});
                i += lifeMatch[0].length;
                canRegex = false;
                continue;
            }
        }

        // Strings: "", ''
        if (code[i] === '"' || code[i] === "'") {
            const q = code[i];
            let j = i + 1;
            while (j < len) {
                if (code[j] === '\\') {
                    j += 2;
                } else if (code[j] === q) {
                    j++;
                    break;
                } else if (code[j] === '\n') {
                    break;
                } else {
                    j++;
                }
            }
            tokens.push({type: 'string', start: baseOffset + i, end: baseOffset + j});
            i = j;
            canRegex = false;
            continue;
        }

        // Template string (JS/TS backticks ``) with ${expr} interpolation
        if (code[i] === '`') {
            const startPos = i;
            i++;
            let strSegmentStart = startPos;

            while (i < len && code[i] !== '`') {
                if (code[i] === '\\') {
                    i += 2;
                } else if (code.startsWith('${', i) && cfg.hasInterpolation) {
                    if (i > strSegmentStart)
                        tokens.push({type: 'string', start: baseOffset + strSegmentStart, end: baseOffset + i});

                    tokens.push({type: 'operator', start: baseOffset + i, end: baseOffset + i + 2});
                    i += 2;

                    let braceDepth = 1;
                    const exprStart = i;
                    while (i < len && braceDepth > 0) {
                        if (code[i] === '{') {
                            braceDepth++;
                            i++;
                        } else if (code[i] === '}') {
                            braceDepth--;
                            if (braceDepth === 0)
                                break;
                            i++;
                        } else if (code[i] === '"' || code[i] === "'") {
                            const subQ = code[i];
                            i++;
                            while (i < len && code[i] !== subQ) {
                                if (code[i] === '\\') i += 2;
                                else i++;
                            }
                            if (i < len) i++;
                        } else {
                            i++;
                        }
                    }

                    if (i > exprStart) {
                        tokenizeCStyle(code.slice(exprStart, i), baseOffset + exprStart, tokens, cfg, dispatcher);
                    }

                    if (i < len && code[i] === '}') {
                        tokens.push({type: 'operator', start: baseOffset + i, end: baseOffset + i + 1});
                        i++;
                    }
                    strSegmentStart = i;
                } else {
                    i++;
                }
            }

            const endPos = i < len ? i + 1 : len;
            if (endPos > strSegmentStart)
                tokens.push({type: 'string', start: baseOffset + strSegmentStart, end: baseOffset + endPos});

            i = endPos;
            canRegex = false;
            continue;
        }

        // JS/TS Regular Expression Literals: /pattern/flags
        if (cfg.hasRegex && canRegex && code[i] === '/' && i + 1 < len && code[i + 1] !== '/' && code[i + 1] !== '*') {
            let j = i + 1;
            let inClass = false;
            let isRegex = false;

            while (j < len && code[j] !== '\n') {
                if (code[j] === '\\') {
                    j += 2;
                } else if (code[j] === '[') {
                    inClass = true;
                    j++;
                } else if (code[j] === ']' && inClass) {
                    inClass = false;
                    j++;
                } else if (code[j] === '/' && !inClass) {
                    j++;
                    while (j < len && /[a-z]/i.test(code[j]))
                        j++;
                    isRegex = true;
                    break;
                } else {
                    j++;
                }
            }

            if (isRegex) {
                tokens.push({type: 'regex', start: baseOffset + i, end: baseOffset + j});
                i = j;
                canRegex = false;
                continue;
            }
        }

        // Numbers: 0x..., 0b..., 0o..., 123.45, 1_000_000, 100n, 1.5f
        if (/\d/.test(code[i]) || (code[i] === '.' && i + 1 < len && /\d/.test(code[i + 1]))) {
            const numMatch = /^(0x[0-9a-fA-F_]+|0b[01_]+|0o[0-7_]+|\d[0-9_]*(\.[0-9_]+)?([eE][+-]?[0-9_]+)?[a-zA-Z0-9_]*)/.exec(code.slice(i));
            if (numMatch && numMatch[0].length > 0) {
                tokens.push({type: 'number', start: baseOffset + i, end: baseOffset + i + numMatch[0].length});
                i += numMatch[0].length;
                canRegex = false;
                continue;
            }
        }

        // Identifiers (keywords, types, literals, functions, Rust macros)
        if (/[a-zA-Z_$]/.test(code[i])) {
            const wordMatch = /^[a-zA-Z0-9_$]+!?/.exec(code.slice(i));
            if (wordMatch) {
                let word = wordMatch[0];
                const hasBang = word.endsWith('!');
                if (hasBang)
                    word = word.slice(0, -1);
                const start = baseOffset + i;
                const end = start + wordMatch[0].length;
                i += wordMatch[0].length;

                if (hasBang) {
                    tokens.push({type: 'function', start, end});
                    canRegex = false;
                } else if (cfg.keywords.has(word)) {
                    tokens.push({type: 'keyword', start, end});
                    canRegex = /^(return|case|throw|yield|await|typeof|instanceof|delete|void|in|of)$/.test(word);
                } else if (cfg.literals.has(word)) {
                    tokens.push({type: 'boolean', start, end});
                    canRegex = false;
                } else if (cfg.types.has(word)) {
                    tokens.push({type: 'type', start, end});
                    canRegex = false;
                } else if (cfg.builtins?.has(word)) {
                    tokens.push({type: 'type', start, end});
                    canRegex = false;
                } else {
                    let next = i;
                    while (next < len && /\s/.test(code[next]))
                        next++;
                    if (next < len && code[next] === '(')
                        tokens.push({type: 'function', start, end});
                    canRegex = false;
                }
                continue;
            }
        }

        // Punctuation
        if (/[{}()[\]:;,.]/.test(code[i])) {
            tokens.push({type: 'punctuation', start: baseOffset + i, end: baseOffset + i + 1});
            canRegex = /[([{,;:]/.test(code[i]);
            i++;
            continue;
        }

        // Multi-character and single-character operators
        const opMatch = /^(===|!==|=>|<=|>=|==|!=|\+\+|--|&&|\|\||\?\?|\?\.|<<|>>|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|\.\.\.|::|->|[+\-*/%=<>!&|^~?])/.exec(code.slice(i));
        if (opMatch) {
            tokens.push({type: 'operator', start: baseOffset + i, end: baseOffset + i + opMatch[0].length});
            i += opMatch[0].length;
            canRegex = true;
            continue;
        }

        i++;
    }
}
