// SPDX-License-Identifier: GPL-3.0-only

const BASH_KEYWORDS = new Set([
    'if', 'then', 'else', 'elif', 'fi', 'case', 'esac', 'for', 'select', 'while',
    'until', 'do', 'done', 'in', 'function', 'return', 'exit', 'local', 'export',
    'readonly', 'source', 'alias', 'set', 'unset', 'eval', 'exec', 'trap'
]);

const BASH_COMMANDS = new Set([
    'echo', 'printf', 'cd', 'pwd', 'ls', 'cat', 'grep', 'egrep', 'fgrep', 'sed', 'awk',
    'cut', 'sort', 'uniq', 'head', 'tail', 'wc', 'find', 'xargs', 'mkdir', 'rmdir',
    'rm', 'cp', 'mv', 'chmod', 'chown', 'touch', 'curl', 'wget', 'tar', 'gzip', 'gunzip',
    'zip', 'unzip', 'git', 'sudo', 'su', 'apt', 'apt-get', 'dnf', 'pacman', 'yum', 'zypper',
    'systemctl', 'journalctl', 'service', 'kill', 'killall', 'ps', 'top', 'htop', 'which',
    'type', 'whereis', 'ssh', 'scp', 'rsync', 'clear', 'diff', 'node', 'npm', 'npx',
    'pnpm', 'yarn', 'bun', 'cargo', 'rustc', 'python', 'python3', 'pip', 'pip3',
    'docker', 'docker-compose', 'podman', 'kubectl', 'make', 'gcc', 'g++', 'clang',
    'mvn', 'gradle', 'nano', 'vim', 'vi', 'man', 'df', 'du', 'free', 'uname', 'env',
    'basename', 'dirname', 'tee', 'ln', 'read', 'sleep'
]);

export function tokenize(code, baseOffset, tokens, dispatcher) {
    const len = code.length;
    let i = 0;
    let isCommandPosition = true;

    while (i < len) {
        // Shebang or Comment: #...
        if (code[i] === '#') {
            const end = code.indexOf('\n', i + 1);
            const tokenEnd = end === -1 ? len : end;
            const isShebang = code.startsWith('#!', i);
            tokens.push({type: isShebang ? 'doctype' : 'comment', start: baseOffset + i, end: baseOffset + tokenEnd});
            i = tokenEnd;
            isCommandPosition = true;
            continue;
        }

        // Single Quoted String: pure literal
        if (code[i] === "'") {
            let j = i + 1;
            while (j < len && code[j] !== "'")
                j++;
            if (j < len) j++;
            tokens.push({type: 'string', start: baseOffset + i, end: baseOffset + j});
            i = j;
            isCommandPosition = false;
            continue;
        }

        // Double Quoted String: tokenizes $VARS inside!
        if (code[i] === '"') {
            const strStart = i;
            i++;
            let segStart = strStart;

            while (i < len && code[i] !== '"') {
                if (code[i] === '\\') {
                    i += 2;
                } else if (code[i] === '$') {
                    if (i > segStart)
                        tokens.push({type: 'string', start: baseOffset + segStart, end: baseOffset + i});
                    const varMatch = /^\$([a-zA-Z0-9_]+|\{[^}]+\}|[#?@*$!0-9])/.exec(code.slice(i));
                    if (varMatch) {
                        tokens.push({type: 'bash-var', start: baseOffset + i, end: baseOffset + i + varMatch[0].length});
                        i += varMatch[0].length;
                    } else {
                        i++;
                    }
                    segStart = i;
                } else {
                    i++;
                }
            }

            const endPos = i < len ? i + 1 : len;
            if (endPos > segStart)
                tokens.push({type: 'string', start: baseOffset + segStart, end: baseOffset + endPos});

            i = endPos;
            isCommandPosition = false;
            continue;
        }

        // Variables: $VAR, ${VAR}, $1, $?
        if (code[i] === '$') {
            const varMatch = /^\$([a-zA-Z0-9_]+|\{[^}]+\}|[#?@*$!0-9])/.exec(code.slice(i));
            if (varMatch) {
                tokens.push({type: 'bash-var', start: baseOffset + i, end: baseOffset + i + varMatch[0].length});
                i += varMatch[0].length;
                isCommandPosition = false;
                continue;
            }
        }

        // Flags & Options: -a, -la, --help
        if (code[i] === '-' && i + 1 < len && /[a-zA-Z0-9-]/.test(code[i + 1])) {
            const flagMatch = /^--?[a-zA-Z0-9_-]+/.exec(code.slice(i));
            if (flagMatch) {
                tokens.push({type: 'attribute', start: baseOffset + i, end: baseOffset + i + flagMatch[0].length});
                i += flagMatch[0].length;
                isCommandPosition = false;
                continue;
            }
        }

        // Identifiers: Commands, Keywords
        if (/[a-zA-Z_]/.test(code[i])) {
            const wordMatch = /^[a-zA-Z0-9_.-]+/.exec(code.slice(i));
            if (wordMatch) {
                const word = wordMatch[0];
                const start = baseOffset + i;
                const end = start + word.length;
                i += word.length;

                if (BASH_KEYWORDS.has(word)) {
                    tokens.push({type: 'keyword', start, end});
                    isCommandPosition = /^(do|then|else|elif|fi|done)$/.test(word);
                } else if (isCommandPosition || BASH_COMMANDS.has(word)) {
                    tokens.push({type: 'bash-command', start, end});
                    isCommandPosition = false;
                }
                continue;
            }
        }

        // Command separators: ;, |, &, newline reset command position
        if (code[i] === '\n' || code[i] === ';' || code[i] === '|' || code[i] === '&') {
            isCommandPosition = true;
            if (code[i] !== '\n')
                tokens.push({type: 'operator', start: baseOffset + i, end: baseOffset + i + 1});
            i++;
            continue;
        }

        if (/[()<>[\]{}]/.test(code[i])) {
            tokens.push({type: 'operator', start: baseOffset + i, end: baseOffset + i + 1});
            i++;
            continue;
        }

        i++;
    }
}
