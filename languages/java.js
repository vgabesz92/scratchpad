// SPDX-License-Identifier: GPL-3.0-only
import {tokenizeCStyle} from './cstyle.js';

const JAVA_KEYWORDS = new Set([
    'abstract', 'assert', 'break', 'case', 'catch', 'class', 'const', 'continue',
    'default', 'do', 'else', 'enum', 'extends', 'final', 'finally', 'for', 'goto',
    'if', 'implements', 'import', 'instanceof', 'interface', 'native', 'new',
    'package', 'private', 'protected', 'public', 'return', 'static', 'strictfp',
    'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient',
    'try', 'void', 'volatile', 'while', 'record', 'sealed', 'permits', 'yield', 'var', 'non-sealed'
]);

const JAVA_TYPES = new Set([
    'boolean', 'byte', 'char', 'short', 'int', 'long', 'float', 'double', 'void',
    'String', 'Object', 'Class', 'System', 'Integer', 'Double', 'Float', 'Long',
    'Boolean', 'Byte', 'Short', 'Character', 'Number',
    'List', 'ArrayList', 'LinkedList', 'Map', 'HashMap', 'TreeMap', 'LinkedHashMap',
    'Set', 'HashSet', 'TreeSet', 'Optional', 'Stream', 'Arrays', 'Collections',
    'StringBuilder', 'StringBuffer', 'Math', 'Thread', 'Runnable',
    'Exception', 'RuntimeException', 'Throwable', 'Error', 'IOException'
]);

const JAVA_LITERALS = new Set(['true', 'false', 'null']);

export function tokenize(code, baseOffset, tokens, dispatcher) {
    tokenizeCStyle(code, baseOffset, tokens, {
        keywords: JAVA_KEYWORDS,
        literals: JAVA_LITERALS,
        types: JAVA_TYPES,
        hasDecorators: true,
    }, dispatcher);
}
