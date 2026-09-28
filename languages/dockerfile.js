// SPDX-License-Identifier: GPL-3.0-only

const DOCKER_INSTRUCTIONS = new Set([
    'FROM', 'RUN', 'CMD', 'LABEL', 'EXPOSE', 'ENV', 'ADD', 'COPY',
    'ENTRYPOINT', 'VOLUME', 'USER', 'WORKDIR', 'ARG', 'ONBUILD',
    'STOPSIGNAL', 'HEALTHCHECK', 'SHELL'
]);

export function tokenize(code, baseOffset, tokens, dispatcher) {
    const len = code.length;
    let i = 0;

    while (i < len) {
        if (code[i] === '#') {
            const end = code.indexOf('\n', i + 1);
            const tokenEnd = end === -1 ? len : end;
            tokens.push({type: 'comment', start: baseOffset + i, end: baseOffset + tokenEnd});
            i = tokenEnd;
            continue;
        }

        // Instructions at start of line
        if (i === 0 || code[i - 1] === '\n') {
            while (i < len && (code[i] === ' ' || code[i] === '\t'))
                i++;
            const instMatch = /^[a-zA-Z]+/.exec(code.slice(i));
            if (instMatch && DOCKER_INSTRUCTIONS.has(instMatch[0].toUpperCase())) {
                tokens.push({type: 'keyword', start: baseOffset + i, end: baseOffset + i + instMatch[0].length});
                i += instMatch[0].length;
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

        // Variables: $VAR, ${VAR}
        if (code[i] === '$') {
            const varMatch = /^\$([a-zA-Z0-9_]+|\{[^}]+\})/.exec(code.slice(i));
            if (varMatch) {
                tokens.push({type: 'bash-var', start: baseOffset + i, end: baseOffset + i + varMatch[0].length});
                i += varMatch[0].length;
                continue;
            }
        }

        i++;
    }
}
