// SPDX-License-Identifier: GPL-3.0-only

export function tokenize(code, baseOffset, tokens, dispatcher) {
    const len = code.length;
    let i = 0;

    while (i < len) {
        // Comment: <!-- ... -->
        if (code.startsWith('<!--', i)) {
            const end = code.indexOf('-->', i + 4);
            const tokenEnd = end === -1 ? len : end + 3;
            tokens.push({type: 'comment', start: baseOffset + i, end: baseOffset + tokenEnd});
            i = tokenEnd;
            continue;
        }

        // CDATA: <![CDATA[ ... ]]>
        if (code.startsWith('<![CDATA[', i)) {
            const end = code.indexOf(']]>', i + 9);
            const tokenEnd = end === -1 ? len : end + 3;
            tokens.push({type: 'comment', start: baseOffset + i, end: baseOffset + tokenEnd});
            i = tokenEnd;
            continue;
        }

        // DOCTYPE or XML PI
        if (code.startsWith('<!DOCTYPE', i) || code.startsWith('<!doctype', i) || code.startsWith('<?xml', i)) {
            const end = code.indexOf('>', i);
            const tokenEnd = end === -1 ? len : end + 1;
            tokens.push({type: 'doctype', start: baseOffset + i, end: baseOffset + tokenEnd});
            i = tokenEnd;
            continue;
        }

        // HTML Entity: &amp; &#123;
        if (code[i] === '&') {
            const entMatch = /^&[a-zA-Z0-9#]+;/.exec(code.slice(i, i + 12));
            if (entMatch) {
                tokens.push({type: 'entity', start: baseOffset + i, end: baseOffset + i + entMatch[0].length});
                i += entMatch[0].length;
                continue;
            }
        }

        // Tag: <...
        if (code[i] === '<' && i + 1 < len && /[a-zA-Z0-9/!_]/.test(code[i + 1])) {
            let tagEnd = -1;
            let inQuote = null;
            for (let j = i + 1; j < len; j++) {
                const c = code[j];
                if (inQuote) {
                    if (c === inQuote)
                        inQuote = null;
                } else if (c === '"' || c === "'") {
                    inQuote = c;
                } else if (c === '>') {
                    tagEnd = j + 1;
                    break;
                }
            }
            if (tagEnd === -1)
                tagEnd = len;

            const tagText = code.slice(i, tagEnd);
            const isScriptOpen = /^<script(\s+[^>]*)?>/i.exec(tagText);
            const isStyleOpen = /^<style(\s+[^>]*)?>/i.exec(tagText);

            tokenizeTagContent(tagText, baseOffset + i, tokens, dispatcher);
            i = tagEnd;

            // Recurse into <script> and <style>
            if (isScriptOpen && dispatcher) {
                const scriptEnd = code.slice(i).search(/<\/script>/i);
                const scriptSliceLen = scriptEnd === -1 ? len - i : scriptEnd;
                if (scriptSliceLen > 0) {
                    dispatcher('javascript', code.slice(i, i + scriptSliceLen), baseOffset + i, tokens);
                    i += scriptSliceLen;
                }
            } else if (isStyleOpen && dispatcher) {
                const styleEnd = code.slice(i).search(/<\/style>/i);
                const styleSliceLen = styleEnd === -1 ? len - i : styleEnd;
                if (styleSliceLen > 0) {
                    dispatcher('css', code.slice(i, i + styleSliceLen), baseOffset + i, tokens);
                    i += styleSliceLen;
                }
            }
            continue;
        }

        i++;
    }
}

function tokenizeTagContent(tagText, offset, tokens, dispatcher) {
    let i = 0;
    if (tagText.startsWith('</')) {
        tokens.push({type: 'punctuation', start: offset, end: offset + 2});
        i = 2;
    } else {
        tokens.push({type: 'punctuation', start: offset, end: offset + 1});
        i = 1;
    }

    while (i < tagText.length && /\s/.test(tagText[i]))
        i++;

    const nameMatch = /^[a-zA-Z0-9:-]+/.exec(tagText.slice(i));
    if (nameMatch) {
        tokens.push({type: 'tag', start: offset + i, end: offset + i + nameMatch[0].length});
        i += nameMatch[0].length;
    }

    while (i < tagText.length) {
        while (i < tagText.length && /\s/.test(tagText[i]))
            i++;
        if (i >= tagText.length)
            break;

        if (tagText[i] === '>') {
            tokens.push({type: 'punctuation', start: offset + i, end: offset + i + 1});
            break;
        }
        if (tagText.startsWith('/>', i)) {
            tokens.push({type: 'punctuation', start: offset + i, end: offset + i + 2});
            break;
        }

        const attrMatch = /^[a-zA-Z0-9_:@.-]+/.exec(tagText.slice(i));
        if (attrMatch) {
            const attrName = attrMatch[0];
            tokens.push({type: 'attribute', start: offset + i, end: offset + i + attrName.length});
            i += attrName.length;

            while (i < tagText.length && /\s/.test(tagText[i]))
                i++;
            if (i < tagText.length && tagText[i] === '=') {
                tokens.push({type: 'punctuation', start: offset + i, end: offset + i + 1});
                i++;
                while (i < tagText.length && /\s/.test(tagText[i]))
                    i++;

                if (i < tagText.length) {
                    if (tagText[i] === '"' || tagText[i] === "'") {
                        const q = tagText[i];
                        const valEnd = tagText.indexOf(q, i + 1);
                        const endPos = valEnd === -1 ? tagText.length : valEnd + 1;
                        const lowerAttr = attrName.toLowerCase();
                        const isStyleAttr = lowerAttr === 'style' || lowerAttr.startsWith('style-') || lowerAttr.startsWith('style:');
                        const isEventHandler = lowerAttr.startsWith('on') && lowerAttr.length > 2;

                        if (dispatcher && valEnd !== -1 && (isStyleAttr || isEventHandler)) {
                            // Opening quote
                            tokens.push({type: 'string', start: offset + i, end: offset + i + 1});
                            const innerContent = tagText.slice(i + 1, valEnd);
                            if (innerContent.length > 0) {
                                if (isStyleAttr)
                                    dispatcher('css-inline', innerContent, offset + i + 1, tokens);
                                else if (isEventHandler)
                                    dispatcher('javascript', innerContent, offset + i + 1, tokens);
                            }
                            // Closing quote
                            tokens.push({type: 'string', start: offset + valEnd, end: offset + valEnd + 1});
                        } else {
                            tokens.push({type: 'string', start: offset + i, end: offset + endPos});
                        }
                        i = endPos;
                    } else {
                        const valMatch = /^[^\s>]+/.exec(tagText.slice(i));
                        if (valMatch) {
                            tokens.push({type: 'string', start: offset + i, end: offset + i + valMatch[0].length});
                            i += valMatch[0].length;
                        }
                    }
                }
            }
            continue;
        }
        i++;
    }
}
