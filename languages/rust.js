// SPDX-License-Identifier: GPL-3.0-only
import {tokenizeCStyle} from './cstyle.js';

const RUST_KEYWORDS = new Set([
    'as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn', 'else',
    'enum', 'extern', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match',
    'mod', 'move', 'mut', 'pub', 'ref', 'return', 'self', 'Self', 'static',
    'struct', 'super', 'trait', 'type', 'union', 'unsafe', 'use', 'where', 'while', 'yield'
]);

const RUST_TYPES = new Set([
    'bool', 'char', 'i8', 'i16', 'i32', 'i64', 'i128', 'isize', 'u8', 'u16',
    'u32', 'u64', 'u128', 'usize', 'f32', 'f64', 'str',
    'String', 'Option', 'Result', 'Some', 'None', 'Ok', 'Err', 'Box', 'Rc', 'Arc',
    'Cell', 'RefCell', 'Mutex', 'RwLock', 'Vec', 'VecDeque', 'LinkedList', 'HashMap',
    'BTreeMap', 'HashSet', 'BTreeSet', 'BinaryHeap'
]);

const RUST_LITERALS = new Set(['true', 'false']);

export function tokenize(code, baseOffset, tokens, dispatcher) {
    tokenizeCStyle(code, baseOffset, tokens, {
        keywords: RUST_KEYWORDS,
        literals: RUST_LITERALS,
        types: RUST_TYPES,
        hasAttributes: true,
        hasLifetimes: true,
    }, dispatcher);
}
