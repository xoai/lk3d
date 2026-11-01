// The examples' helper: a scene from scenes/NAME.json, with any model given as a file read into base64 (as a build
// tool would embed it in the page).
export async function scene(name) {
  const s = await (await fetch(`scenes/${name}.json`)).json();
  for (const m of Object.values(s.models || {})) {
    if (m.file && !m.data) {
      const b = new Uint8Array(await (await fetch(m.file)).arrayBuffer());
      let t = '';
      for (let k = 0; k < b.length; k += 0x8000) t += String.fromCharCode(...b.subarray(k, k + 0x8000));
      m.data = btoa(t);
    }
  }
  return s;
}
