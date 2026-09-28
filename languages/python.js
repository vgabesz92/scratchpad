// SPDX-License-Identifier: GPL-3.0-only

const PY_KEYWORDS = new Set([
    'and', 'as', 'assert', 'async', 'await', 'break', 'case', 'class', 'continue',
    'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global',
    'if', 'import', 'in', 'is', 'lambda', 'match', 'nonlocal', 'not', 'or',
    'pass', 'raise', 'return', 'try', 'while', 'with', 'yield'
]);

const PY_LITERALS = new Set(['True', 'False', 'None']);

const PY_BUILTINS = new Set([
    'abs', 'all', 'any', 'bin', 'bool', 'bytearray', 'bytes', 'callable', 'chr',
    'classmethod', 'compile', 'complex', 'delattr', 'dict', 'dir', 'divmod',
    'enumerate', 'eval', 'exec', 'filter', 'float', 'format', 'frozenset', 'getattr',
    'globals', 'hasattr', 'hash', 'help', 'hex', 'id', 'input', 'int', 'isinstance',
    'issubclass', 'iter', 'len', 'list', 'locals', 'map', 'max', 'memoryview', 'min',
    'next', 'object', 'oct', 'open', 'ord', 'pow', 'print', 'property', 'range',
    'repr', 'reversed', 'round', 'set', 'setattr', 'slice', 'sorted', 'staticmethod',
    'str', 'sum', 'super', 'tuple', 'type', 'vars', 'zip'
]);

const PY_SPECIAL = new Set([
    'self', 'cls', '__name__', '__doc__', '__file__', '__main__', '__dict__',
    '__init__', '__str__', '__repr__', '__len__', '__getitem__', '__setitem__',
    '__delitem__', '__iter__', '__next__', '__enter__', '__exit__', '__call__',
    '__all__', '__slots__'
]);

const PY_EXCEPTIONS = new Set([
    'BaseException', 'Exception', 'ArithmeticError', 'AssertionError', 'AttributeError',
    'EOFError', 'ImportError', 'ModuleNotFoundError', 'IndexError', 'KeyError',
    'KeyboardInterrupt', 'MemoryError', 'NameError', 'OSError', 'OverflowError',
    'RecursionError', 'ReferenceError', 'RuntimeError', 'StopIteration', 'SyntaxError',
    'IndentationError', 'SystemError', 'SystemExit', 'TypeError', 'ValueError',
    'ZeroDivisionError', 'FileNotFoundError', 'PermissionError'
]);

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

        // Strings with prefixes (f, r, b, u, rf, fr) and quotes (single, double, triple)
        const strPrefixMatch = /^[fFrRbBuU]*(?:"""|'''|"|')/.exec(code.slice(i));
        if (strPrefixMatch) {
            const prefixAndQuote = strPrefixMatch[0];
            const isTriple = prefixAndQuote.endsWith('"""') || prefixAndQuote.endsWith("'''");
            const q = isTriple ? prefixAndQuote.slice(-3) : prefixAndQuote.slice(-1);
            const isFString = /^[fF]/.test(prefixAndQuote);

            const qStart = i + prefixAndQuote.length;
            const endIdx = code.indexOf(q, qStart);
            const tokenEnd = endIdx === -1 ? len : endIdx + q.length;

            if (isFString && !isTriple && endIdx !== -1) {
                let cur = i;
                tokens.push({type: 'string', start: baseOffset + cur, end: baseOffset + qStart});
                cur = qStart;

                while (cur < endIdx) {
                    if (code[cur] === '{' && cur + 1 < endIdx && code[cur + 1] !== '{') {
                        const braceEnd = code.indexOf('}', cur + 1);
                        if (braceEnd !== -1 && braceEnd < endIdx) {
                            tokens.push({type: 'operator', start: baseOffset + cur, end: baseOffset + cur + 1});
                            tokenize(code.slice(cur + 1, braceEnd), baseOffset + cur + 1, tokens, dispatcher);
                            tokens.push({type: 'operator', start: baseOffset + braceEnd, end: baseOffset + braceEnd + 1});
                            cur = braceEnd + 1;
                            continue;
                        }
                    }
                    const nextBrace = code.indexOf('{', cur);
                    const segEnd = (nextBrace === -1 || nextBrace > endIdx) ? endIdx : nextBrace;
                    if (segEnd > cur)
                        tokens.push({type: 'string', start: baseOffset + cur, end: baseOffset + segEnd});
                    cur = segEnd;
                }
                tokens.push({type: 'string', start: baseOffset + endIdx, end: baseOffset + tokenEnd});
            } else {
                tokens.push({type: 'string', start: baseOffset + i, end: baseOffset + tokenEnd});
            }

            i = tokenEnd;
            continue;
        }

        // Decorators: @decorator
        if (code[i] === '@') {
            const decMatch = /^@[a-zA-Z0-9_.]+/.exec(code.slice(i));
            if (decMatch) {
                tokens.push({type: 'function', start: baseOffset + i, end: baseOffset + i + decMatch[0].length});
                i += decMatch[0].length;
                continue;
            }
        }

        // Numbers: 0x..., 0b..., 1_000_000, 1.5e-3, 3j
        if (/\d/.test(code[i]) || (code[i] === '.' && i + 1 < len && /\d/.test(code[i + 1]))) {
            const numMatch = /^(0x[0-9a-fA-F_]+|0b[01_]+|0o[0-7_]+|\d[0-9_]*(\.[0-9_]+)?([eE][+-]?[0-9_]+)?[jJ]?)/.exec(code.slice(i));
            if (numMatch && numMatch[0].length > 0) {
                tokens.push({type: 'number', start: baseOffset + i, end: baseOffset + i + numMatch[0].length});
                i += numMatch[0].length;
                continue;
            }
        }

        // Identifiers: keywords, literals, builtins, self, dunder
        if (/[a-zA-Z_]/.test(code[i])) {
            const wordMatch = /^[a-zA-Z0-9_]+/.exec(code.slice(i));
            if (wordMatch) {
                const word = wordMatch[0];
                const start = baseOffset + i;
                const end = start + word.length;
                i += word.length;

                if (PY_KEYWORDS.has(word)) {
                    tokens.push({type: 'keyword', start, end});
                } else if (PY_LITERALS.has(word)) {
                    tokens.push({type: 'boolean', start, end});
                } else if (PY_SPECIAL.has(word)) {
                    tokens.push({type: 'variable', start, end});
                } else if (PY_EXCEPTIONS.has(word)) {
                    tokens.push({type: 'type', start, end});
                } else if (PY_BUILTINS.has(word)) {
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

        // Punctuation
        if (/[{}()[\]:;.,]/.test(code[i])) {
            tokens.push({type: 'punctuation', start: baseOffset + i, end: baseOffset + i + 1});
            i++;
            continue;
        }

        // Operators
        const opMatch = /^(==|!=|<=|>=|\+=|-=|\*=|\/=|%=|\/\/=|\*\*=|<<=|>>=|&=|\|=|\^=|:=|\*\*|\/\/|->|[+\-*/%=<>!&|^~])/.exec(code.slice(i));
        if (opMatch) {
            tokens.push({type: 'operator', start: baseOffset + i, end: baseOffset + i + opMatch[0].length});
            i += opMatch[0].length;
            continue;
        }

        i++;
    }
}
