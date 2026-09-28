// SPDX-License-Identifier: GPL-3.0-only
//
// Syntax highlighting engine for Scratchpad.
// Provides base color palette, Pango attribute generation, language auto-detection,
// and on-demand dynamic loading of individual language tokenizers.

import Pango from 'gi://Pango';

// Theme palette: GitHub Dark / VS Code Dark Plus colors with high contrast
const THEME_COLORS = {
    keyword:           '#ff7b72', // Coral red: control keywords, declarations
    tag:               '#7ee787', // Soft emerald green: HTML/XML tag names
    attribute:         '#79c0ff', // Sky blue: HTML attributes, CSS properties, JSON keys
    string:            '#a5d6ff', // Soft light blue: string literals
    comment:           '#8b949e', // Muted slate gray (italic): comments
    number:            '#ffa657', // Warm amber: numbers, units, constants
    boolean:           '#ff7b72', // Coral red: booleans, null, undefined
    function:          '#d2a8ff', // Soft purple: function names, calls, decorators
    type:              '#ffa657', // Warm amber: classes, types, builtins
    punctuation:       '#8b949e', // Muted gray: brackets, braces, semicolons
    operator:          '#ff7b72', // Coral red: operators
    doctype:           '#d2a8ff', // Soft purple: DOCTYPE, preprocessor, PHP tags
    entity:            '#79c0ff', // Sky blue: HTML entities
    'css-property':    '#79c0ff', // Sky blue: CSS properties
    'css-selector':    '#7ee787', // Soft green: CSS classes, IDs, selectors
    'bash-command':    '#d2a8ff', // Soft purple: CLI commands
    'bash-var':        '#ffa657', // Warm amber: shell/PHP variables ($VAR)
    'diff-add':        '#7ee787', // Green: added diff lines
    'diff-remove':     '#ff7b72', // Red: removed diff lines
    'diff-meta':       '#79c0ff', // Cyan: diff chunk headers
    'fence-marker':    '#6e7681', // Dim gray: ``` and ~~~ fence backticks
    'fence-lang':      '#58a6ff', // Vibrant cyan-blue (bold): language identifier
    'markdown-header': '#79c0ff', // Sky blue (bold): markdown headers
    'markdown-bold':   '#e6edf3', // Bright white (bold): bold text
    'markdown-italic': '#e6edf3', // Bright white (italic): italic text
    'markdown-quote':  '#8b949e', // Slate gray (italic): blockquotes
    'markdown-link':   '#58a6ff', // Blue: links
    'markdown-list':   '#ff7b72', // Coral red: list bullets/numbers
    regex:             '#7ee787', // Green: regular expressions
    variable:          '#ffa657', // Amber: special variables, self, cls
};

function hexToPangoRgb(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3)
        hex = hex.split('').map(c => c + c).join('');
    const r = parseInt(hex.substring(0, 2), 16) * 257;
    const g = parseInt(hex.substring(2, 4), 16) * 257;
    const b = parseInt(hex.substring(4, 6), 16) * 257;
    return [r, g, b];
}

const PANGO_COLORS = {};
for (const [key, hex] of Object.entries(THEME_COLORS))
    PANGO_COLORS[key] = hexToPangoRgb(hex);

/**
 * Precompute UTF-16 character index to UTF-8 byte offset lookup table.
 * Pango attributes require byte offsets, whereas JavaScript operates on char indices.
 */
export function buildCharToByteTable(text) {
    const len = text.length;
    const table = new Uint32Array(len + 1);
    let byteOffset = 0;
    for (let i = 0; i < len; i++) {
        table[i] = byteOffset;
        const code = text.charCodeAt(i);
        if (code <= 0x7f) {
            byteOffset += 1;
        } else if (code <= 0x7ff) {
            byteOffset += 2;
        } else if (code >= 0xd800 && code <= 0xdbff) {
            byteOffset += 4;
            i++;
            if (i < len)
                table[i] = byteOffset;
        } else {
            byteOffset += 3;
        }
    }
    table[len] = byteOffset;
    return table;
}

// --------------------------------------------------------------------------
// Language Registry & Eager Loader
// --------------------------------------------------------------------------

import {tokenize as tokenizeBash} from './languages/bash.js';
import {tokenize as tokenizeC} from './languages/c.js';
import {tokenize as tokenizeCpp} from './languages/cpp.js';
import {tokenize as tokenizeCsharp} from './languages/csharp.js';
import {tokenize as tokenizeCss, tokenizeInline as tokenizeCssInline} from './languages/css.js';
import {tokenize as tokenizeDiff} from './languages/diff.js';
import {tokenize as tokenizeDockerfile} from './languages/dockerfile.js';
import {tokenize as tokenizeGo} from './languages/go.js';
import {tokenize as tokenizeHtml} from './languages/html.js';
import {tokenize as tokenizeJava} from './languages/java.js';
import {tokenize as tokenizeJavascript} from './languages/javascript.js';
import {tokenize as tokenizeJson} from './languages/json.js';
import {tokenize as tokenizeMarkdown} from './languages/markdown.js';
import {tokenize as tokenizePhp} from './languages/php.js';
import {tokenize as tokenizePython} from './languages/python.js';
import {tokenize as tokenizeRust} from './languages/rust.js';
import {tokenize as tokenizeSql} from './languages/sql.js';
import {tokenize as tokenizeToml} from './languages/toml.js';
import {tokenize as tokenizeTypescript} from './languages/typescript.js';
import {tokenize as tokenizeYaml} from './languages/yaml.js';

const LANGUAGE_REGISTRY = new Map([
    ['bash', tokenizeBash],
    ['c', tokenizeC],
    ['cpp', tokenizeCpp],
    ['csharp', tokenizeCsharp],
    ['css', tokenizeCss],
    ['css-inline', tokenizeCssInline],
    ['diff', tokenizeDiff],
    ['dockerfile', tokenizeDockerfile],
    ['go', tokenizeGo],
    ['html', tokenizeHtml],
    ['java', tokenizeJava],
    ['javascript', tokenizeJavascript],
    ['json', tokenizeJson],
    ['markdown', tokenizeMarkdown],
    ['php', tokenizePhp],
    ['python', tokenizePython],
    ['rust', tokenizeRust],
    ['sql', tokenizeSql],
    ['toml', tokenizeToml],
    ['typescript', tokenizeTypescript],
    ['yaml', tokenizeYaml],
]);

const PENDING_LOADS = new Map();
let refreshCallback = null;

/**
 * Register a UI refresh callback to be invoked when an on-demand language finishes loading.
 */
export function setRefreshCallback(fn) {
    refreshCallback = fn;
}

/**
 * Check if a language tokenizer module has already been loaded into memory.
 */
export function isLanguageLoaded(lang) {
    const normalized = normalizeLanguage(lang) || lang;
    return LANGUAGE_REGISTRY.has(normalized);
}

/**
 * Dynamically load a language tokenizer module on demand (or return cached).
 */
export async function loadLanguage(lang) {
    const normalized = normalizeLanguage(lang) || lang;
    if (LANGUAGE_REGISTRY.has(normalized))
        return LANGUAGE_REGISTRY.get(normalized);

    if (PENDING_LOADS.has(normalized))
        return PENDING_LOADS.get(normalized);

    const promise = (async () => {
        try {
            const mod = await import(`./languages/${normalized}.js`);
            if (mod && typeof mod.tokenize === 'function') {
                LANGUAGE_REGISTRY.set(normalized, mod.tokenize);
                if (refreshCallback) {
                    try {
                        refreshCallback();
                    } catch (e) {
                        console.error(`[Scratchpad] Error in syntax refreshCallback: ${e.message}`);
                    }
                }
                return mod.tokenize;
            }
        } catch (err) {
            console.error(`[Scratchpad] Failed to load language module "${normalized}": ${err.message}`);
        } finally {
            PENDING_LOADS.delete(normalized);
        }
        return null;
    })();

    PENDING_LOADS.set(normalized, promise);
    return promise;
}

/**
 * Trigger background on-demand load if language is not yet in registry.
 */
export function ensureLanguage(lang) {
    const normalized = normalizeLanguage(lang) || lang;
    if (!LANGUAGE_REGISTRY.has(normalized) && !PENDING_LOADS.has(normalized))
        loadLanguage(normalized);
}

/**
 * Fast synchronous fallback tokenizer while an on-demand language module is loading (~2ms).
 * Highlights comments, strings, numbers, and brackets so the editor is never blank.
 */
function fallbackTokenizer(code, baseOffset, tokens) {
    const len = code.length;
    let i = 0;
    while (i < len) {
        if (code.startsWith('//', i) || code.startsWith('#', i) || code.startsWith('--', i)) {
            const end = code.indexOf('\n', i + 1);
            const tokenEnd = end === -1 ? len : end;
            tokens.push({type: 'comment', start: baseOffset + i, end: baseOffset + tokenEnd});
            i = tokenEnd;
            continue;
        }
        if (code.startsWith('/*', i) || code.startsWith('<!--', i)) {
            const close = code.startsWith('/*', i) ? '*/' : '-->';
            const end = code.indexOf(close, i + 2);
            const tokenEnd = end === -1 ? len : end + close.length;
            tokens.push({type: 'comment', start: baseOffset + i, end: baseOffset + tokenEnd});
            i = tokenEnd;
            continue;
        }
        if (code[i] === '"' || code[i] === "'" || code[i] === '`') {
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
        if (/\d/.test(code[i])) {
            const numMatch = /^[0-9a-fA-FxX._]+/.exec(code.slice(i));
            if (numMatch) {
                tokens.push({type: 'number', start: baseOffset + i, end: baseOffset + i + numMatch[0].length});
                i += numMatch[0].length;
                continue;
            }
        }
        if (/[{}()[\]:,;.]/.test(code[i])) {
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

/**
 * Tokenize code by language, using dynamically loaded tokenizer if ready,
 * or queuing it and using fallback.
 */
export function tokenizeByLanguage(lang, code, baseOffset, tokens) {
    const normalized = normalizeLanguage(lang) || lang || 'javascript';
    const tokenizer = LANGUAGE_REGISTRY.get(normalized);
    if (tokenizer) {
        tokenizer(code, baseOffset, tokens, tokenizeByLanguage);
    } else {
        ensureLanguage(normalized);
        fallbackTokenizer(code, baseOffset, tokens);
    }
}

// --------------------------------------------------------------------------
// Language Normalization & Auto-Detection
// --------------------------------------------------------------------------

/**
 * Normalizes language aliases from markdown fence headers (e.g. ```html, ```js).
 */
export function normalizeLanguage(lang) {
    if (!lang)
        return null;
    const l = lang.trim().toLowerCase();
    switch (l) {
        case 'html': case 'htm': case 'xhtml': case 'xml': case 'svg': case 'rss': case 'atom':
            return 'html';
        case 'js': case 'javascript': case 'mjs': case 'cjs': case 'jsx': case 'node':
            return 'javascript';
        case 'ts': case 'typescript': case 'tsx': case 'mts': case 'cts':
            return 'typescript';
        case 'css': case 'scss': case 'sass': case 'less': case 'postcss':
            return 'css';
        case 'css-inline':
            return 'css-inline';
        case 'py': case 'python': case 'py3': case 'python3':
            return 'python';
        case 'json': case 'jsonc': case 'json5': case 'geojson':
            return 'json';
        case 'bash': case 'sh': case 'zsh': case 'shell': case 'ksh': case 'console': case 'terminal': case 'zshrc': case 'bashrc':
            return 'bash';
        case 'c': case 'h':
            return 'c';
        case 'cpp': case 'c++': case 'cc': case 'cxx': case 'hpp': case 'hxx':
            return 'cpp';
        case 'cs': case 'csharp': case 'c#': case 'dotnet':
            return 'csharp';
        case 'java': case 'jsp':
            return 'java';
        case 'rs': case 'rust':
            return 'rust';
        case 'go': case 'golang':
            return 'go';
        case 'sql': case 'mysql': case 'pgsql': case 'postgres': case 'postgresql': case 'sqlite': case 'tsql': case 'plsql':
            return 'sql';
        case 'php': case 'phtml': case 'php3': case 'php4': case 'php5': case 'php7': case 'php8':
            return 'php';
        case 'yaml': case 'yml':
            return 'yaml';
        case 'toml': case 'ini': case 'conf': case 'cfg': case 'properties':
            return 'toml';
        case 'docker': case 'dockerfile': case 'containerfile':
            return 'dockerfile';
        case 'md': case 'markdown': case 'mdown': case 'mkdn':
            return 'markdown';
        case 'diff': case 'patch':
            return 'diff';
        default:
            return null;
    }
}

/**
 * Auto-detect programming language from code using multi-factor heuristics
 * and token scoring.
 */
export function detectLanguage(text) {
    const trimmed = text.trim();
    if (!trimmed)
        return null;

    // Fast Path 1: Shebang
    if (trimmed.startsWith('#!')) {
        const firstLine = trimmed.split('\n')[0];
        if (/bash|sh|zsh/.test(firstLine))
            return 'bash';
        if (/python/.test(firstLine))
            return 'python';
        if (/node|bun|deno/.test(firstLine))
            return 'javascript';
        if (/perl/.test(firstLine))
            return 'bash';
        if (/php/.test(firstLine))
            return 'php';
    }

    // Fast Path 2: Diff / Patch
    if (/^diff --git\s|^index\s[0-9a-f]+\.\.[0-9a-f]+|^\+{3}\s[b/]|^-{3}\s[a/]|^@@\s-[0-9,]+\s\+[0-9,]+\s@@/m.test(trimmed))
        return 'diff';

    // Fast Path 3: Dockerfile
    if (/^FROM\s+[a-zA-Z0-9_.:\/-]+(\s+AS\s+[a-zA-Z0-9_-]+)?/mi.test(trimmed))
        return 'dockerfile';

    // Fast Path 4: PHP
    if (/^<\?php|<\?=/i.test(trimmed))
        return 'php';

    // Fast Path 5: HTML / XML
    if (/^<!DOCTYPE\s+html/i.test(trimmed) ||
        /<html\b/i.test(trimmed) ||
        /<\/?(head|body|div|span|p|a|h[1-6]|button|input|table|tr|td|th|ul|ol|li|script|style|header|footer|nav|section|article|form|label|meta|link|img|svg|iframe)\b/i.test(trimmed))
        return 'html';

    // Fast Path 6: JSON
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
            JSON.parse(trimmed);
            return 'json';
        } catch (_) {
            if (/"[a-zA-Z0-9_$-]+"\s*:/.test(trimmed))
                return 'json';
        }
    }

    // Fast Path 7: Markdown
    if (/^#{1,6}\s+\S+/m.test(trimmed) && (/(\*\*|__)\S+.*(\*\*|__)/m.test(trimmed) || /\[.+\]\(https?:\/\/.+\)/.test(trimmed) || /^\s*-\s+\[[ x]\]/m.test(trimmed)))
        return 'markdown';

    // Fast Path 8: TOML / INI
    if (/^\s*\[[a-zA-Z0-9_.-]+\]\s*$/m.test(trimmed) && /^\s*[a-zA-Z0-9_.-]+\s*=\s*/m.test(trimmed))
        return 'toml';

    // Scored heuristics across candidates
    const scores = {
        sql: 0,
        python: 0,
        rust: 0,
        go: 0,
        java: 0,
        csharp: 0,
        cpp: 0,
        c: 0,
        typescript: 0,
        javascript: 0,
        bash: 0,
        yaml: 0,
        css: 0,
        markdown: 0,
    };

    // SQL scores
    if (/\bSELECT\b/i.test(trimmed) && /\bFROM\b/i.test(trimmed)) scores.sql += 8;
    if (/\b(INSERT\s+INTO|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i.test(trimmed)) scores.sql += 8;
    if (/\bWHERE\b/i.test(trimmed)) scores.sql += 3;
    if (/\b(GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT)\b/i.test(trimmed)) scores.sql += 4;
    if (/\b(INNER|LEFT|RIGHT|FULL)\s+JOIN\b/i.test(trimmed)) scores.sql += 5;

    // Python scores
    if (/\bdef\s+[a-zA-Z_][a-zA-Z0-9_]*\s*\(/.test(trimmed)) scores.python += 7;
    if (/\bclass\s+[a-zA-Z_][a-zA-Z0-9_]*(\([^)]*\))?:/.test(trimmed)) scores.python += 5;
    if (/\b(import\s+[a-zA-Z_][a-zA-Z0-9_.]*|from\s+[a-zA-Z_][a-zA-Z0-9_.]*\s+import)\b/.test(trimmed)) scores.python += 6;
    if (/\b(self|cls)\b/.test(trimmed)) scores.python += 5;
    if (/\belif\s+/.test(trimmed)) scores.python += 6;
    if (/\bprint\s*\(/.test(trimmed)) scores.python += 3;
    if (/:\s*\n\s{4,}/.test(trimmed)) scores.python += 4;
    if (/if\s+__name__\s*==\s*['"]__main__['"]/.test(trimmed)) scores.python += 9;

    // Rust scores
    if (/\bfn\s+[a-z_][a-z0-9_]*\s*\(/.test(trimmed)) scores.rust += 8;
    if (/\blet\s+(mut\s+)?[a-z_][a-z0-9_]*\s*[:=]/.test(trimmed)) scores.rust += 6;
    if (/\b(impl|trait)\s+[A-Z]/.test(trimmed)) scores.rust += 6;
    if (/\bprintln!\s*\(/.test(trimmed)) scores.rust += 8;
    if (/::[a-zA-Z0-9_]+/.test(trimmed)) scores.rust += 2;
    if (/->\s*(Result|Option)\s*</.test(trimmed)) scores.rust += 6;

    // Go scores
    if (/\bpackage\s+[a-z_]+\b/.test(trimmed)) scores.go += 9;
    if (/\bfunc\s+(\([^)]+\)\s+)?[a-zA-Z_][a-zA-Z0-9_]*\s*\(/.test(trimmed)) scores.go += 8;
    if (/\bfmt\.(Print|Println|Printf)\s*\(/.test(trimmed)) scores.go += 8;
    if (/:=\s*/.test(trimmed)) scores.go += 6;
    if (/\bgo\s+func\s*\(/.test(trimmed)) scores.go += 7;

    // Java scores
    if (/\bpublic\s+class\s+[A-Z]/.test(trimmed)) scores.java += 8;
    if (/\bpublic\s+static\s+void\s+main\s*\(/.test(trimmed)) scores.java += 9;
    if (/\bSystem\.(out|err)\.(print|println)\s*\(/.test(trimmed)) scores.java += 8;
    if (/\bimport\s+java\./.test(trimmed)) scores.java += 8;
    if (/@Override\b/.test(trimmed)) scores.java += 6;
    if (/\b(private|protected|public)\s+(final\s+)?(void|int|boolean|String)\s+[a-zA-Z_]/.test(trimmed)) scores.java += 5;

    // C# scores
    if (/\busing\s+System(\.[a-zA-Z0-9_]+)*;/.test(trimmed)) scores.csharp += 9;
    if (/\bnamespace\s+[A-Z]/.test(trimmed)) scores.csharp += 6;
    if (/\bConsole\.(Write|WriteLine)\s*\(/.test(trimmed)) scores.csharp += 8;
    if (/\bvar\s+[a-zA-Z_][a-zA-Z0-9_]*\s*=\s*new\s+/.test(trimmed)) scores.csharp += 4;
    if (/\b(string|int|bool)\[\]/.test(trimmed)) scores.csharp += 3;

    // C / C++ scores
    if (/#include\s+[<"][a-zA-Z0-9_./]+[>"]/.test(trimmed)) { scores.c += 7; scores.cpp += 7; }
    if (/\bstd::/.test(trimmed)) scores.cpp += 8;
    if (/\bcout\s*<<|\bcin\s*>>/.test(trimmed)) scores.cpp += 8;
    if (/\bint\s+main\s*\([^)]*\)\s*\{/.test(trimmed)) { scores.c += 6; scores.cpp += 6; }
    if (/\bprintf\s*\(|\bmalloc\s*\(|\bfree\s*\(/.test(trimmed)) scores.c += 6;
    if (/\btemplate\s*<|\bnullptr\b/.test(trimmed)) scores.cpp += 6;

    // TypeScript & JavaScript scores
    if (/\binterface\s+[A-Z][a-zA-Z0-9_]*\s*\{/.test(trimmed) && /:\s*(string|number|boolean|any|void)\s*;/.test(trimmed)) scores.typescript += 8;
    if (/\btype\s+[A-Z][a-zA-Z0-9_]*\s*=\s*/.test(trimmed)) scores.typescript += 7;
    if (/:\s*(string|number|boolean|any|unknown|never)\b/.test(trimmed)) scores.typescript += 5;
    if (/\b(const|let|var)\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*=/.test(trimmed)) { scores.javascript += 6; scores.typescript += 5; }
    if (/\bfunction\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*\(/.test(trimmed)) { scores.javascript += 6; scores.typescript += 5; }
    if (/\bconsole\.(log|error|warn|info)\s*\(/.test(trimmed)) { scores.javascript += 7; scores.typescript += 6; }
    if (/=>\s*\{?/.test(trimmed)) { scores.javascript += 5; scores.typescript += 5; }
    if (/\b(document|window)\.[a-zA-Z_]/.test(trimmed)) scores.javascript += 7;

    // Bash scores
    if (/\b(npm|yarn|pnpm|npx)\s+(install|run|start|build|add|test)\b/.test(trimmed)) scores.bash += 8;
    if (/\bdocker\s+(run|build|compose|ps|stop|exec)\b/.test(trimmed)) scores.bash += 8;
    if (/\bgit\s+(commit|push|pull|status|checkout|add|clone|branch)\b/.test(trimmed)) scores.bash += 8;
    if (/\b(sudo|apt|apt-get|dnf|pacman|systemctl|journalctl)\s+/.test(trimmed)) scores.bash += 8;
    if (/\b(echo|printf|cd|grep|chmod|chown)\s+/.test(trimmed)) scores.bash += 6;
    if (/\$[A-Z_]{2,}\b|\$\{[A-Z_]{2,}\}/.test(trimmed)) scores.bash += 5;
    if (/\|\s*(grep|awk|sed|sort|uniq|head|tail|wc)\b/.test(trimmed)) scores.bash += 6;

    // YAML scores
    if (/^[a-zA-Z0-9_.-]+:\s*($|\S)/m.test(trimmed) && /^[ \t]*-[ \t]+\S+/m.test(trimmed)) scores.yaml += 7;
    if (/^[a-zA-Z0-9_.-]+:\s+[^\n]+/m.test(trimmed) && !/[;{}]/.test(trimmed)) scores.yaml += 4;

    // CSS scores
    if (/[.#]?[a-zA-Z_-][a-zA-Z0-9_ -]*\s*\{\s*([a-zA-Z-]+:\s*[^;]+;?\s*)+\}/.test(trimmed)) {
        if (/margin:|padding:|color:|background:|border:|display:|font-size:|position:/.test(trimmed))
            scores.css += 8;
    }

    // Markdown scores
    if (/^#{1,6}\s+\S+/m.test(trimmed)) scores.markdown += 4;
    if (/^[ \t]*[-*+]\s+\S+/m.test(trimmed) && !scores.yaml) scores.markdown += 3;

    // Find highest score
    let highestLang = null;
    let highestScore = 0;

    for (const [lang, score] of Object.entries(scores)) {
        if (score > highestScore) {
            highestScore = score;
            highestLang = lang;
        }
    }

    if (highestScore >= 4)
        return highestLang;

    // Fallbacks
    if (/[{};]/.test(trimmed))
        return 'javascript';

    if (/^#\s*\S+/m.test(trimmed))
        return 'python';

    return null;
}

/**
 * Extracts markdown code fences and inline snippets.
 */
export function getCodeSnippetRanges(text) {
    if (!text)
        return [];

    const fenceRegex = /(?:^|\n)[ ]{0,3}((`{3,}|~{3,}))[^\n]*(?:\n[\s\S]*?(?:\n[ ]{0,3}\1[ ]*(?=\n|$)|$)|\n?$)/g;
    const ranges = [];
    let m;
    while ((m = fenceRegex.exec(text)) !== null) {
        const start = m.index + (m[0].startsWith('\n') ? 1 : 0);
        const end = m.index + m[0].length;
        if (end > start)
            ranges.push({start, end});
        if (m.index === fenceRegex.lastIndex)
            fenceRegex.lastIndex++;
    }

    const inlineRegex = /(`+)([\s\S]*?[^`])\1(?!`)/g;
    while ((m = inlineRegex.exec(text)) !== null) {
        const start = m.index;
        const end = m.index + m[0].length;
        if (m[0].includes('\n\n'))
            continue;
        const overlaps = ranges.some(r => Math.max(start, r.start) < Math.min(end, r.end));
        if (!overlaps)
            ranges.push({start, end});
    }

    ranges.sort((a, b) => a.start - b.start);
    return ranges;
}

/**
 * Builds Pango.AttrList containing syntax highlighting foreground colors,
 * fonts, and font styles for the editor text.
 *
 * @param {string} text The full editor text
 * @param {boolean} isSnippetsPad Whether the active tab is the Snippets (Kódok) tab
 * @param {boolean} [enableSyntax=true] Whether syntax color highlighting is enabled
 * @returns {Pango.AttrList|null}
 */
export function createSyntaxAttributes(text, isSnippetsPad, enableSyntax = true) {
    if (!text)
        return null;

    if (!enableSyntax && isSnippetsPad)
        return null;

    const charToByte = buildCharToByteTable(text);
    const textLen = text.length;

    // Markdown fence pattern: matches ```<lang>\n<code>\n``` or in-progress typing ```<lang>\n<code>
    const fenceRegex = /(?:^|\n)[ ]{0,3}((`{3,}|~{3,}))([^\n]*)(?:\n([\s\S]*?)(?:\n[ ]{0,3}\1[ ]*(?=\n|$)|$)|\n?$)/g;
    const blocks = [];
    let m;

    while ((m = fenceRegex.exec(text)) !== null) {
        const fullMatch = m[0];
        const start = m.index + (fullMatch.startsWith('\n') ? 1 : 0);
        const end = m.index + fullMatch.length;
        const marker = m[1];
        const info = m[3] || '';
        const code = m[4] !== undefined ? m[4] : '';

        const markerStart = start;
        const markerEnd = start + marker.length;
        const infoStart = markerEnd;
        const infoEnd = start + marker.length + info.length;

        const codeStart = infoEnd < end && text[infoEnd] === '\n' ? infoEnd + 1 : infoEnd;
        const codeEnd = codeStart + code.length;

        let closeStart = -1;
        let closeEnd = -1;
        if (codeEnd < end) {
            const remainder = text.slice(codeEnd);
            const closeMatch = /^[ ]{0,3}(`{3,}|~{3,})/.exec(remainder.startsWith('\n') ? remainder.slice(1) : remainder);
            if (closeMatch) {
                const offset = remainder.startsWith('\n') ? codeEnd + 1 : codeEnd;
                closeStart = offset;
                closeEnd = offset + closeMatch[0].length;
            }
        }

        blocks.push({
            start, end,
            markerStart, markerEnd,
            info: info.trim(),
            infoStart, infoEnd,
            codeStart, codeEnd,
            code,
            closeStart, closeEnd,
        });

        if (m.index === fenceRegex.lastIndex)
            fenceRegex.lastIndex++;
    }

    const tokens = [];

    if (blocks.length > 0) {
        for (const b of blocks) {
            tokens.push({type: 'fence-marker', start: b.markerStart, end: b.markerEnd});

            if (b.info)
                tokens.push({type: 'fence-lang', start: b.infoStart, end: b.infoEnd});

            const lang = normalizeLanguage(b.info) || detectLanguage(b.code) || 'javascript';
            tokenizeByLanguage(lang, b.code, b.codeStart, tokens);

            if (b.closeStart !== -1 && b.closeEnd !== -1)
                tokens.push({type: 'fence-marker', start: b.closeStart, end: b.closeEnd});
        }
    } else if (isSnippetsPad) {
        const lang = detectLanguage(text) || 'javascript';
        tokenizeByLanguage(lang, text, 0, tokens);
    } else {
        // On Notes/Scratchpad without fences: check inline code and markdown
        tokenizeByLanguage('markdown', text, 0, tokens);
        const inlineRegex = /(`+)([\s\S]*?[^`])\1(?!`)/g;
        while ((m = inlineRegex.exec(text)) !== null) {
            if (m[0].includes('\n\n'))
                continue;
            tokens.push({type: 'inline-code', start: m.index, end: m.index + m[0].length});
        }
        if (tokens.length === 0)
            return null;
    }

    // On non-snippets pad, check inline code outside code blocks
    if (!isSnippetsPad && blocks.length > 0) {
        const inlineRegex = /(`+)([\s\S]*?[^`])\1(?!`)/g;
        while ((m = inlineRegex.exec(text)) !== null) {
            if (m[0].includes('\n\n'))
                continue;
            const start = m.index;
            const end = m.index + m[0].length;
            const overlaps = blocks.some(b => Math.max(start, b.start) < Math.min(end, b.end));
            if (!overlaps)
                tokens.push({type: 'inline-code', start, end});
        }
    }

    const attrList = new Pango.AttrList();

    // On non-snippets pad (Notes, Scratch), code blocks and inline code get monospace font
    if (!isSnippetsPad) {
        for (const b of blocks) {
            const fontAttr = Pango.attr_family_new('monospace');
            fontAttr.start_index = charToByte[Math.min(b.start, textLen)];
            fontAttr.end_index = charToByte[Math.min(b.end, textLen)];
            attrList.insert(fontAttr);
        }
        for (const t of tokens) {
            if (t.type === 'inline-code') {
                const fontAttr = Pango.attr_family_new('monospace');
                fontAttr.start_index = charToByte[Math.min(t.start, textLen)];
                fontAttr.end_index = charToByte[Math.min(t.end, textLen)];
                attrList.insert(fontAttr);
            }
        }
    }

    // Apply syntax color, style (italic for comments), and weight (bold for fence language tags / headers)
    if (enableSyntax) {
        for (const token of tokens) {
            if (token.type === 'inline-code')
                continue;

            const startByte = charToByte[Math.min(token.start, textLen)];
            const endByte = charToByte[Math.min(token.end, textLen)];
            if (endByte <= startByte)
                continue;

            const rgb = PANGO_COLORS[token.type];
            if (rgb) {
                const colorAttr = Pango.attr_foreground_new(rgb[0], rgb[1], rgb[2]);
                colorAttr.start_index = startByte;
                colorAttr.end_index = endByte;
                attrList.insert(colorAttr);
            }

            if (token.type === 'comment' || token.type === 'markdown-quote' || token.type === 'markdown-italic') {
                const italicAttr = Pango.attr_style_new(Pango.Style.ITALIC);
                italicAttr.start_index = startByte;
                italicAttr.end_index = endByte;
                attrList.insert(italicAttr);
            } else if (token.type === 'fence-lang' || token.type === 'markdown-header' || token.type === 'markdown-bold') {
                const boldAttr = Pango.attr_weight_new(Pango.Weight.BOLD);
                boldAttr.start_index = startByte;
                boldAttr.end_index = endByte;
                attrList.insert(boldAttr);
            }
        }
    }

    return attrList;
}
