// SPDX-License-Identifier: GPL-3.0-only
import {tokenizeCStyle} from './cstyle.js';

const CPP_KEYWORDS = new Set([
    'alignas', 'alignof', 'and', 'and_eq', 'asm', 'auto', 'bitand', 'bitor', 'break',
    'case', 'catch', 'class', 'compl', 'concept', 'const', 'consteval', 'constexpr',
    'constinit', 'const_cast', 'continue', 'co_await', 'co_return', 'co_yield',
    'decltype', 'default', 'delete', 'do', 'dynamic_cast', 'else', 'enum', 'explicit',
    'export', 'extern', 'final', 'for', 'friend', 'goto', 'if', 'inline', 'mutable',
    'namespace', 'new', 'noexcept', 'not', 'not_eq', 'operator', 'or', 'or_eq',
    'override', 'private', 'protected', 'public', 'register', 'reinterpret_cast',
    'requires', 'return', 'sizeof', 'static', 'static_assert', 'static_cast', 'struct',
    'switch', 'template', 'this', 'thread_local', 'throw', 'try', 'typedef', 'typeid',
    'typename', 'union', 'using', 'virtual', 'void', 'volatile', 'while', 'xor', 'xor_eq'
]);

const CPP_TYPES = new Set([
    'int', 'char', 'float', 'double', 'void', 'bool', 'short', 'long', 'signed',
    'unsigned', 'size_t', 'ssize_t', 'intptr_t', 'uintptr_t', 'ptrdiff_t',
    'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t',
    'string', 'wstring', 'u16string', 'u32string', 'string_view',
    'vector', 'deque', 'list', 'forward_list', 'array', 'map', 'unordered_map',
    'set', 'unordered_set', 'pair', 'tuple', 'unique_ptr', 'shared_ptr', 'weak_ptr',
    'optional', 'variant', 'any', 'span'
]);

const CPP_LITERALS = new Set(['true', 'false', 'nullptr', 'NULL']);

export function tokenize(code, baseOffset, tokens, dispatcher) {
    tokenizeCStyle(code, baseOffset, tokens, {
        keywords: CPP_KEYWORDS,
        literals: CPP_LITERALS,
        types: CPP_TYPES,
        hasPreprocessor: true,
    }, dispatcher);
}
