// @ts-check
// A figure's state (or any JSON) as text for a link, and back: LK3D.encodeState(state), LK3D.decodeState(text), both
// Promises. The text is a marker, then base64url: z, the JSON compressed (deflate-raw, where the browser has
// CompressionStream), or b, the JSON as it is. A text with no marker is a Share link the playground made before 0.4.0
// (compressed, no marker); one whose marker does not read is taken as such a link too, since its first letter may be
// z or b by chance.

const toText = (/** @type {Uint8Array} */ bytes) => {
  let binary = '';
  for (let k = 0; k < bytes.length; k += 0x8000) binary += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const toBytes = (/** @type {string} */ text) =>
  Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
/** @param {Uint8Array} bytes @param {any} stream */
const through = async (bytes, stream) =>
  new Uint8Array(await new Response(new Blob([/** @type {any} */ (bytes)]).stream().pipeThrough(stream)).arrayBuffer());
const inflate = async (/** @type {string} */ text) =>
  JSON.parse(new TextDecoder().decode(await through(toBytes(text), new DecompressionStream('deflate-raw'))));

/** @param {unknown} state */
export async function encodeState(state) {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  return typeof CompressionStream === 'function'
    ? 'z' + toText(await through(bytes, new CompressionStream('deflate-raw')))
    : 'b' + toText(bytes);
}

/** @param {string} text */
export async function decodeState(text) {
  text = String(text).trim();
  try {
    if (text[0] === 'z') return await inflate(text.slice(1));
    if (text[0] === 'b') return JSON.parse(new TextDecoder().decode(toBytes(text.slice(1))));
  } catch {
    // (an old link that happens to start with z or b)
  }
  return inflate(text);
}
