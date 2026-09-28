// SPDX-License-Identifier: GPL-3.0-only
import {tokenizeCStyle} from './cstyle.js';

const C_KEYWORDS = new Set([
    'auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do',
    'double', 'else', 'enum', 'extern', 'float', 'for', 'goto', 'if', 'inline',
    'int', 'long', 'register', 'restrict', 'return', 'short', 'signed', 'sizeof',
    'static', 'struct', 'switch', 'typedef', 'union', 'unsigned', 'void',
    'volatile', 'while', '_Alignas', '_Alignof', '_Atomic', '_Bool', '_Complex',
    '_Generic', '_Imaginary', '_Noreturn', '_Static_assert', '_Thread_local'
]);

const C_TYPES = new Set([
    'int', 'char', 'float', 'double', 'void', 'bool', 'short', 'long', 'signed',
    'unsigned', 'size_t', 'ssize_t', 'intptr_t', 'uintptr_t', 'ptrdiff_t',
    'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t',
    'FILE', 'time_t', 'clock_t'
]);

const C_LITERALS = new Set(['true', 'false', 'NULL']);

export function tokenize(code, baseOffset, tokens, dispatcher) {
    tokenizeCStyle(code, baseOffset, tokens, {
        keywords: C_KEYWORDS,
        literals: C_LITERALS,
        types: C_TYPES,
        hasPreprocessor: true,
    }, dispatcher);
}
