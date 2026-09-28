// SPDX-License-Identifier: GPL-3.0-only

const PHP_KEYWORDS = new Set([
    'function', 'class', 'public', 'private', 'protected', 'return', 'echo', 'print',
    'if', 'else', 'elseif', 'foreach', 'as', 'array', 'new', 'try', 'catch', 'throw',
    'finally', 'namespace', 'use', 'extends', 'implements', 'interface', 'trait',
    'static', 'final', 'const', 'global', 'var', 'match', 'yield', 'fn', 'readonly',
    'enum', 'abstract', 'default', 'goto', 'instanceof', 'insteadof', 'declare',
    'include', 'include_once', 'require', 'require_once', 'switch', 'case', 'break',
    'continue', 'while', 'do'
]);

const PHP_TYPES = new Set([
    'int', 'string', 'bool', 'float', 'array', 'object', 'void', 'mixed', 'never',
    'callable', 'iterable', 'self', 'parent'
]);

const PHP_LITERALS = new Set([
    'true', 'false', 'null', '__DIR__', '__FILE__', '__LINE__', '__CLASS__',
    '__METHOD__', '__FUNCTION__', '__NAMESPACE__'
]);

export function tokenize(code, baseOffset, tokens, dispatcher) {
    const len = code.length;
    let i = 0;

    while (i < len) {
        // PHP tags: <?php, <?=, ?>
        if (code.startsWith('<?php', i) || code.startsWith('<?=', i) || code.startsWith('<?', i) || code.startsWith('?>', i)) {
            const match = /^<\?php|<\?=|<\?|\?>/.exec(code.slice(i));
            tokens.push({type: 'doctype', start: baseOffset + i, end: baseOffset + i + match[0].length});
            i += match[0].length;
            continue;
        }

        // Comments: //, #, /* ... */
        if (code.startsWith('//', i) || code[i] === '#') {
            const end = code.indexOf('\n', i + 1);
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

        // Variables: $var
        if (code[i] === '$') {
            const varMatch = /^\$[a-zA-Z_\x7f-\xff][a-zA-Z0-9_\x7f-\xff]*/.exec(code.slice(i));
            if (varMatch) {
                tokens.push({type: 'bash-var', start: baseOffset + i, end: baseOffset + i + varMatch[0].length});
                i += varMatch[0].length;
                continue;
            }
        }

        // Strings
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

        // Numbers
        if (/\d/.test(code[i])) {
            const numMatch = /^(0x[0-9a-fA-F_]+|0b[01_]+|\d[0-9_]*(\.[0-9_]+)?)/.exec(code.slice(i));
            if (numMatch) {
                tokens.push({type: 'number', start: baseOffset + i, end: baseOffset + i + numMatch[0].length});
                i += numMatch[0].length;
                continue;
            }
        }

        // Identifiers: keywords, types, literals
        if (/[a-zA-Z_]/.test(code[i])) {
            const wordMatch = /^[a-zA-Z0-9_]+/.exec(code.slice(i));
            if (wordMatch) {
                const word = wordMatch[0];
                const start = baseOffset + i;
                const end = start + word.length;
                i += word.length;

                if (PHP_KEYWORDS.has(word.toLowerCase())) {
                    tokens.push({type: 'keyword', start, end});
                } else if (PHP_LITERALS.has(word)) {
                    tokens.push({type: 'boolean', start, end});
                } else if (PHP_TYPES.has(word.toLowerCase())) {
                    tokens.push({type: 'type', start, end});
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

        // Punctuation & operators
        if (/[{}()[\]:;.,]/.test(code[i])) {
            tokens.push({type: 'punctuation', start: baseOffset + i, end: baseOffset + i + 1});
            i++;
            continue;
        }
        if (/[+\-*/%=<>!&|^~]/.test(code[i])) {
            tokens.push({type: 'operator', start: baseOffset + i, end: baseOffset + i + 1});
            i++;
            continue;
        }

        i++;
    }
}
