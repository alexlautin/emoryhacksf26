// Icons: a small SVG sprite served as /icons.svg. UI icons from Lucide (lucide-static, ISC license);
// agent logos from Lobe Icons (@lobehub/icons-static-svg, MIT), as `brand-<agent kind>`.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.js';

export const ICONS = [
  'terminal', 'square-terminal', 'globe', 'file', 'file-text', 'wrench', 'message-square', 'eye', 'eye-off',
  'key-round', 'upload', 'package', 'pause', 'play', 'octagon-x', 'octagon-alert', 'triangle-alert', 'circle-pause',
  'shield', 'shield-check', 'shield-off', 'shield-alert', 'sun', 'moon', 'monitor', 'check', 'info', 'x', 'bot', 'settings',
  'layout-dashboard', 'bell', 'search', 'chevron-right', 'chevron-down', 'folder', 'download', 'sparkles', 'list-tree',
];
export const BRANDS = {
  claude: 'claudecode', codex: 'codex', gemini: 'geminicli', cursor: 'cursor',
  copilot: 'githubcopilot', opencode: 'opencode', amp: 'amp',
};
// Full-color versions for the sidebar. Agents without one use the plain logo.
export const BRAND_COLORS = { claude: 'claudecode-color', codex: 'codex-color', gemini: 'gemini-color', amp: 'amp-color' };
export const LUCIDE_DIR = path.join(ROOT, 'node_modules', 'lucide-static', 'icons');
export const BRAND_DIR = path.join(ROOT, 'node_modules', '@lobehub', 'icons-static-svg', 'icons');
export const FONT_FILE = path.join(ROOT, 'node_modules', '@fontsource-variable', 'instrument-sans', 'files', 'instrument-sans-latin-wght-normal.woff2');

const innerOf = (svg) => svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1, svg.lastIndexOf('</svg>')).trim();

let sprite = null;
export function iconSprite() {
  if (sprite) return sprite;
  const symbols = ICONS.map((name) => {
    const svg = fs.readFileSync(path.join(LUCIDE_DIR, `${name}.svg`), 'utf8');
    return `<symbol id="${name}" viewBox="0 0 24 24">${innerOf(svg)}</symbol>`;
  });
  for (const [kind, file] of Object.entries(BRANDS)) {
    const svg = fs.readFileSync(path.join(BRAND_DIR, `${file}.svg`), 'utf8').replace(/<title>.*?<\/title>/, '');
    symbols.push(`<symbol id="brand-${kind}" viewBox="0 0 24 24"><g fill="currentColor" fill-rule="evenodd">${innerOf(svg)}</g></symbol>`);
    const color = BRAND_COLORS[kind];
    const colored = color ? fs.readFileSync(path.join(BRAND_DIR, `${color}.svg`), 'utf8').replace(/<title>.*?<\/title>/, '') : null;
    symbols.push(colored
      ? `<symbol id="brandc-${kind}" viewBox="0 0 24 24">${innerOf(colored)}</symbol>`
      : `<symbol id="brandc-${kind}" viewBox="0 0 24 24"><g fill="currentColor" fill-rule="evenodd">${innerOf(svg)}</g></symbol>`);
  }
  sprite = `<svg xmlns="http://www.w3.org/2000/svg">${symbols.join('')}</svg>`;
  return sprite;
}
