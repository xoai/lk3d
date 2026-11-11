// The playground's checks, in a worker so typing never waits for them: the scene's text read as JSON (a mistake there
// named by its line and column), then lk3d's validator (the format: lk3d/validate) and its geometry check (lk3d/lint:
// parts that run into each other when taken apart, parts in the air, hidden labels), the same as `lk3d check`.
//   post { id, text, models } → { id, scene, syntax, problems: [{ path, message, kind }], summary }
import { validate } from '../src/validate.js';
import { lint } from '../src/lint.js';

self.onmessage = ({ data }) => {
  const { id, text, models } = data;
  let scene;
  try {
    scene = JSON.parse(text);
  } catch (error) {
    // (V8 says "at position N", Firefox "at line L column C": the place, as the editor wants it)
    const message = String(error.message),
      position = /position (\d+)/.exec(message),
      lineColumn = /line (\d+) column (\d+)/.exec(message);
    let offset = position ? +position[1] : null;
    if (offset == null && lineColumn) {
      const lines = text.split('\n').slice(0, +lineColumn[1] - 1);
      offset = lines.reduce((sum, line) => sum + line.length + 1, 0) + +lineColumn[2] - 1;
    }
    self.postMessage({ id, syntax: { message: message.replace(/^JSON\.parse: /, ''), offset } });
    return;
  }
  const problems = validate(scene).map((problem) => ({ ...problem, kind: 'format' }));
  let summary = null;
  if (!problems.length) {
    // (the geometry, with the models' data the page has read, as a build would)
    const withModels = { ...scene, models: { ...scene.models } };
    for (const [name, model] of Object.entries(withModels.models || {}))
      if (models[name]) withModels.models[name] = { ...model, data: models[name] };
    try {
      const result = lint(withModels);
      summary = result.summary;
      for (const problem of result.problems) problems.push({ ...problem, kind: 'geometry' });
    } catch (error) {
      problems.push({ path: '', message: String(error.message || error), kind: 'geometry' });
    }
  }
  self.postMessage({ id, scene, problems, summary });
};
