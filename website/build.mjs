// Rebuild website/dist from the sources in this folder. No dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { page } from './src/layout.mjs';
import { renderMarkdown } from './src/markdown.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

export function build() {
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(path.join(dist, 'js'), { recursive: true });

  const home = fs.readFileSync(path.join(root, 'src', 'home.html'), 'utf8');
  fs.writeFileSync(path.join(dist, 'index.html'), page({
    title: 'Lookout. See what your coding agent actually runs.',
    description: 'Lookout follows Claude Code, Codex, and the other coding agents it recognizes, down through the shells and package scripts they start. It stays on your machine.',
    current: 'home',
    body: home,
    script: true,
  }));

  const article = `<article class="paper">\n${renderMarkdown(fs.readFileSync(path.join(root, 'whitepaper.md'), 'utf8'))}\n</article>\n`;
  fs.writeFileSync(path.join(dist, 'whitepaper.html'), page({
    title: 'Lookout white paper',
    description: 'How Lookout watches coding agents: process polls, decoy files, the rules, the score out of 100, and the limits.',
    current: 'paper',
    body: article,
  }));

  fs.writeFileSync(path.join(dist, '404.html'), page({
    title: 'Page not found. Lookout',
    description: 'That page is not on the Lookout site.',
    current: '',
    body: `<div class="missing"><h1>That page is not here.</h1><p><a href="/">Back to the front page</a>.</p></div>`,
  }));

  for (const name of ['os.js', 'downloads.js', 'site.js']) {
    copy(path.join(root, 'src', 'js', name), path.join(dist, 'js', name));
  }
  copy(path.join(root, 'releases.js'), path.join(dist, 'releases.js'));
  copy(path.join(root, 'src', 'site.css'), path.join(dist, 'site.css'));
  copy(path.join(root, 'src', 'favicon.svg'), path.join(dist, 'favicon.svg'));
  copy(path.join(root, 'whitepaper.md'), path.join(dist, 'whitepaper.md'));
  return dist;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = build();
  console.log(`Built ${out}`);
}
