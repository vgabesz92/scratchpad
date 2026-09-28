// SPDX-License-Identifier: GPL-3.0-only
import {tokenizeCStyle} from './cstyle.js';

const CS_KEYWORDS = new Set([
    'abstract', 'as', 'base', 'break', 'case', 'catch', 'checked', 'class',
    'const', 'continue', 'default', 'delegate', 'do', 'else', 'enum', 'event',
    'explicit', 'extern', 'finally', 'fixed', 'for', 'foreach', 'goto', 'if',
    'implicit', 'in', 'interface', 'internal', 'is', 'lock', 'namespace', 'new',
    'operator', 'out', 'override', 'params', 'private', 'protected', 'public',
    'readonly', 'ref', 'return', 'sealed', 'sizeof', 'stackalloc', 'static',
    'struct', 'switch', 'this', 'throw', 'try', 'typeof', 'unchecked', 'unsafe',
    'using', 'virtual', 'void', 'volatile', 'while', 'async', 'await', 'get', 'set',
    'record', 'init', 'var', 'when', 'yield', 'nameof', 'not', 'and', 'or', 'with', 'global'
]);

const CS_TYPES = new Set([
    'bool', 'byte', 'sbyte', 'char', 'decimal', 'double', 'float', 'int', 'uint',
    'nint', 'nuint', 'long', 'ulong', 'short', 'ushort', 'object', 'string', 'dynamic',
    'Task', 'ValueTask', 'List', 'Dictionary', 'HashSet', 'Queue', 'Stack', 'Action',
    'Func', 'Predicate', 'IEnumerable', 'ICollection', 'IList', 'IDictionary',
    'IReadOnlyList', 'IReadOnlyCollection', 'Nullable', 'Guid', 'DateTime', 'TimeSpan', 'Exception'
]);

const CS_LITERALS = new Set(['true', 'false', 'null']);

export function tokenize(code, baseOffset, tokens, dispatcher) {
    tokenizeCStyle(code, baseOffset, tokens, {
        keywords: CS_KEYWORDS,
        literals: CS_LITERALS,
        types: CS_TYPES,
        hasDecorators: true,
        hasAttributes: true,
        hasInterpolation: true,
    }, dispatcher);
}
