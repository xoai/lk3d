// Where each value of a JSON text is, by the path the validator names it with (parts[2].shapes[0].lathe): a map from
// path to [start, end] offsets in the text, so a problem can be shown where it is. Read with a small scanner of its own
// (JSON.parse says nothing about places); a text JSON.parse refuses gives what it read before the mistake.
export function locate(text) {
  const places = new Map();
  let at = 0;
  const space = () => {
    while (at < text.length && /\s/.test(text[at])) at++;
  };
  const string = () => {
    const start = at++;
    while (at < text.length && text[at] !== '"') at += text[at] === '\\' ? 2 : 1;
    at++;
    return JSON.parse(text.slice(start, at));
  };
  const value = (path) => {
    space();
    const start = at;
    if (text[at] === '{') {
      at++;
      space();
      while (at < text.length && text[at] !== '}') {
        const key = string();
        space();
        at++; // (the colon)
        value(path ? `${path}.${key}` : key);
        space();
        if (text[at] === ',') at++;
        space();
      }
      at++;
    } else if (text[at] === '[') {
      at++;
      space();
      for (let index = 0; at < text.length && text[at] !== ']'; index++) {
        value(`${path}[${index}]`);
        space();
        if (text[at] === ',') at++;
        space();
      }
      at++;
    } else if (text[at] === '"') string();
    else while (at < text.length && /[^\s,}\]]/.test(text[at])) at++;
    places.set(path, [start, at]);
  };
  try {
    value('');
  } catch {
    // (a text that is not JSON: the places read so far)
  }
  return places;
}

// the place of a path, or of the nearest enclosing value that has one (a missing field: the object it belongs in)
export function placeOf(places, path) {
  for (let probe = path; ;) {
    if (places.has(probe)) return places.get(probe);
    const up = probe.endsWith(']') ? probe.replace(/\[\d+\]$/, '') : probe.replace(/\.?[^.[\]]+$/, '');
    if (up === probe) return null;
    probe = up;
  }
}
