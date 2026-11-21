// Writes llms.txt and llms-full.txt (https://llmstxt.org): for an AI agent asked to use lk3d, an index of the guides,
// each with its first sentence, and the guides joined into one file. npm run docs writes them into dist/ (the npm
// package carries them); the Pages job writes them at the site's root, beside the guides it publishes.
//   node scripts/llms.mjs [DIR]          (dist/ by default)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
  OUT = path.resolve(process.argv[2] || path.join(ROOT, 'dist')),
  SITE = 'https://xoai.github.io/lk3d',
  // the guides, in the order an agent should read them
  GUIDES = [
    ['skill/lk3d/SKILL.md', 'How to build a figure, as the lk3d skill teaches an agent'],
    ['docs/scene-format.md'],
    ['docs/shapes.md'],
    ['docs/api.md'],
    ['docs/handles-and-lines.md'],
    ['docs/looks-and-materials.md'],
    ['docs/fluids.md'],
    ['docs/models.md'],
    ['docs/recipes.md'],
    ['docs/accessibility.md'],
    ['docs/performance.md'],
    ['docs/design.md'],
  ].filter(([file]) => fs.existsSync(path.join(ROOT, file)));

// a guide's title and its first sentence (the first paragraph that is prose: not a heading, a list, a table or code)
function about(file) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/^---\n[\s\S]*?\n---\n/, ''),
    title = text.match(/^# (.+)$/m)?.[1] || path.basename(file, '.md'),
    paragraph = text
      .split(/\n\s*\n/)
      .map((block) => block.trim())
      .find((block) => block && !/^(#|[-*|>![]|```|\d+\.|<)/.test(block));
  // (a sentence that leads into a list or code ends in a colon: its first clause, as a sentence)
  const sentence = (paragraph || '').replace(/\s+/g, ' ').match(/^.+?[.!?:](?=\s|$)/);
  return { title, sentence: sentence ? sentence[0].replace(/:$/, '.').replace(/\*\*/g, '') : '' };
}

const readme = about('README.md');
const index = [
  '# lk3d',
  '',
  `> ${readme.sentence}`,
  '',
  'Scenes are JSON, checked by a schema (' +
    `${SITE}/schema/1/scene.schema.json) and by \`npx lk3d check\`; \`npx lk3d render\` draws them to look at. ` +
    'Install the skill for an agent with `npx lk3d skill install`.',
  '',
  '## Guides',
  '',
  ...GUIDES.map(([file, given]) => {
    const { title, sentence } = about(file);
    return `- [${title}](${SITE}/${file}): ${given || sentence}`;
  }),
  '',
  '## Optional',
  '',
  `- [Everything above in one file](${SITE}/llms-full.txt)`,
  `- [The playground](${SITE}/playground/): write a scene and see it drawn`,
  '',
].join('\n');
const full = [readme, ...GUIDES.map(([file]) => file)]
  .map((file) => (typeof file === 'string' ? file : 'README.md'))
  .map((file) => `<!-- ${file} -->\n\n${fs.readFileSync(path.join(ROOT, file), 'utf8').trim()}\n`)
  .join('\n');
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'llms.txt'), index);
fs.writeFileSync(path.join(OUT, 'llms-full.txt'), full);
console.log(`${path.relative(process.cwd(), OUT) || '.'}/llms.txt (${GUIDES.length} guides) and llms-full.txt`);
