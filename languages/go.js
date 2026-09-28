// SPDX-License-Identifier: GPL-3.0-only
import {tokenizeCStyle} from './cstyle.js';

const GO_KEYWORDS = new Set([
    'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else',
    'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import', 'interface',
    'map', 'package', 'range', 'return', 'select', 'struct', 'switch', 'type', 'var'
]);

const GO_TYPES = new Set([
    'bool', 'string', 'int', 'int8', 'int16', 'int32', 'int64', 'uint', 'uint8',
    'uint16', 'uint32', 'uint64', 'uintptr', 'byte', 'rune', 'float32', 'float64',
    'complex64', 'complex128', 'error', 'any'
]);

const GO_BUILTINS = new Set([
    'make', 'len', 'cap', 'new', 'append', 'copy', 'close', 'delete', 'panic',
    'recover', 'print', 'println', 'complex', 'real', 'imag'
]);

const GO_LITERALS = new Set(['true', 'false', 'nil', 'iota']);

export function tokenize(code, baseOffset, tokens, dispatcher) {
    tokenizeCStyle(code, baseOffset, tokens, {
        keywords: GO_KEYWORDS,
        literals: GO_LITERALS,
        types: GO_TYPES,
        builtins: GO_BUILTINS,
    }, dispatcher);
}
