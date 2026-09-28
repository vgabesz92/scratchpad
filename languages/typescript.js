// SPDX-License-Identifier: GPL-3.0-only
import {tokenizeCStyle} from './cstyle.js';

const TS_KEYWORDS = new Set([
    'abstract', 'as', 'asserts', 'async', 'await', 'break', 'case', 'catch', 'class',
    'const', 'continue', 'debugger', 'declare', 'default', 'delete', 'do', 'else',
    'enum', 'export', 'extends', 'finally', 'for', 'from', 'function', 'get',
    'if', 'implements', 'import', 'in', 'infer', 'instanceof', 'interface', 'is',
    'keyof', 'let', 'module', 'namespace', 'new', 'of', 'override', 'package',
    'private', 'protected', 'public', 'readonly', 'return', 'satisfies', 'set',
    'static', 'super', 'switch', 'target', 'this', 'throw', 'try', 'type', 'typeof',
    'var', 'void', 'while', 'with', 'yield'
]);

const TS_LITERALS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);

const TS_TYPES = new Set([
    'any', 'boolean', 'number', 'string', 'symbol', 'void', 'unknown', 'never', 'object', 'bigint',
    'String', 'Number', 'Boolean', 'Symbol', 'Array', 'Object', 'Function', 'Promise',
    'Map', 'Set', 'WeakMap', 'WeakSet', 'Error', 'RegExp', 'Date', 'ArrayBuffer',
    'Uint8Array', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Int16Array', 'Int32Array',
    'Float32Array', 'Float64Array', 'BigInt', 'Proxy', 'Reflect', 'HTMLElement', 'Element',
    'Node', 'Event', 'CustomEvent', 'Record', 'Partial', 'Required', 'Readonly', 'Pick',
    'Omit', 'Exclude', 'Extract', 'NonNullable', 'ReturnType', 'InstanceType', 'Parameters'
]);

const TS_BUILTINS = new Set([
    'console', 'window', 'document', 'globalThis', 'Math', 'JSON', 'process',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'fetch', 'require',
    'module', 'exports'
]);

export function tokenize(code, baseOffset, tokens, dispatcher) {
    tokenizeCStyle(code, baseOffset, tokens, {
        keywords: TS_KEYWORDS,
        literals: TS_LITERALS,
        types: TS_TYPES,
        builtins: TS_BUILTINS,
        hasRegex: true,
        hasInterpolation: true,
        hasDecorators: true,
    }, dispatcher);
}
