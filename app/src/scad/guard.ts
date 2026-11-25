const banned: Record<string, string> = {
  minkowski: 'minkowski() is not supported here because it is very slow. Use hull() instead.',
  text: 'text() is not supported yet because no font is loaded.',
};

// Blanks out comments and string contents so a banned word inside them does not count.
function stripCommentsAndStrings(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      const end = source.indexOf('\n', i);
      i = end < 0 ? source.length : end;
    } else if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 2;
      out += ' ';
    } else if (source[i] === '"') {
      i++;
      while (i < source.length && source[i] !== '"') i += source[i] === '\\' ? 2 : 1;
      i++;
      out += '""';
    } else {
      out += source[i];
      i++;
    }
  }
  return out;
}

// Returns a message when the code calls something version 1 does not allow, otherwise null.
export function findBannedCall(source: string): string | null {
  const match = /(?<![\w$])(minkowski|text)\s*\(/.exec(stripCommentsAndStrings(source));
  return match ? banned[match[1]!]! : null;
}
