// Text edits are applied to the original source; layout never comes from the model.
const fixedArguments = new Map([
  ['vspace', 1], ['hspace', 1], ['color', 1], ['textcolor', 1], ['href', 1],
  ['url', 1], ['path', 1], ['label', 1], ['ref', 1], ['pageref', 1],
  ['fontsize', 2], ['setlength', 2], ['addtolength', 2], ['rule', 2],
  ['includeonly', 1], ['newcommand', 3], ['renewcommand', 3]
]);
function groupEnd(source, start, open = '{', close = '}') {
  if (source[start] !== open) return start;
  let depth = 1;
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === '\\') { i++; continue; }
    if (source[i] === open) depth++;
    if (source[i] === close && --depth === 0) return i + 1;
  }
  throw new Error('The LaTeX template contains an unclosed argument.');
}
function skipArguments(source, start, count) {
  let cursor = start;
  for (let n = 0; n < count; n++) {
    const next = cursor + (source.slice(cursor).match(/^\s*/)?.[0].length || 0);
    if (source[next] !== '{') break;
    cursor = groupEnd(source, next);
  }
  return cursor;
}
export function latexTextSlots(source) {
  const marker = '\\begin{document}', body = source.indexOf(marker);
  if (body < 0) throw new Error('A standalone LaTeX master is required.');
  const limit = source.lastIndexOf('\\end{document}'), slots = [];
  let cursor = body + marker.length;
  while (cursor < limit) {
    const char = source[cursor];
    if (char === '%') { const end = source.indexOf('\n', cursor); cursor = end < 0 ? limit : end; continue; }
    if (char === '$') { const end = source.indexOf('$', cursor + 1); cursor = end < 0 ? limit : end + 1; continue; }
    if (char === '\\') {
      const command = source.slice(cursor).match(/^\\([a-zA-Z]+)\*?/);
      if (!command) { cursor += 2; if (source[cursor] === '[') cursor = groupEnd(source, cursor, '[', ']'); continue; }
      const name = command[1]; cursor += command[0].length;
      if (source[cursor] === '[') cursor = groupEnd(source, cursor, '[', ']');
      if (name === 'begin' || name === 'end') {
        const next = cursor + (source.slice(cursor).match(/^\s*/)?.[0].length || 0);
        const end = groupEnd(source, next), env = source.slice(next + 1, end - 1);
        cursor = end;
        if (name === 'begin') {
          if (source[cursor] === '[') cursor = groupEnd(source, cursor, '[', ']');
          cursor = skipArguments(source, cursor, ({ minipage: 1, tabularx: 2, tabular: 1, multicols: 1 })[env] || 0);
        }
      } else cursor = skipArguments(source, cursor, fixedArguments.get(name) || 0);
      continue;
    }
    if ('{}[]&\r\n'.includes(char)) { cursor++; continue; }
    const start = cursor;
    while (cursor < limit && !'\\%${}[]&\r\n'.includes(source[cursor])) cursor++;
    const raw = source.slice(start, cursor), leading = raw.match(/^\s*/)[0].length, trailing = raw.match(/\s*$/)[0].length;
    if (raw.trim()) slots.push({ id: 'text-' + String(slots.length + 1).padStart(3, '0'), text: raw.trim(), start: start + leading, end: cursor - trailing });
  }
  return slots;
}
const escapeText = value => value.replace(/[{}$&#%_^~]/g, char => ({ '{': '\\{', '}': '\\}', '$': '\\$', '&': '\\&', '#': '\\#', '%': '\\%', '_': '\\_', '^': '\\textasciicircum{}', '~': '\\textasciitilde{}' })[char]);
export function applyLatexTextEdits(source, edits) {
  if (!Array.isArray(edits)) throw new Error('The CV draft must contain text replacements for the master template.');
  const slots = new Map(latexTextSlots(source).map(slot => [slot.id, slot])), seen = new Set(), changes = [];
  for (const edit of edits) {
    const slot = slots.get(edit?.id);
    if (!slot || seen.has(edit.id) || typeof edit.text !== 'string' || /[\\\x00-\x1f\x7f]/.test(edit.text) || edit.text.length > Math.max(500, slot.text.length * 2)) throw new Error('The CV draft attempted to change the template or returned invalid text.');
    seen.add(edit.id); changes.push({ ...slot, replacement: escapeText(edit.text.trim()) });
  }
  let result = source;
  for (const change of changes.sort((a, b) => b.start - a.start)) result = result.slice(0, change.start) + change.replacement + result.slice(change.end);
  return result;
}
