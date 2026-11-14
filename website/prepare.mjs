import fs from 'node:fs';
const here = new URL('./', import.meta.url);
const output = new URL('public/', here);
fs.mkdirSync(output, { recursive: true });
fs.copyFileSync(new URL('about.md', here), new URL('about.md', output));
fs.cpSync(new URL('../public/ui/', here), new URL('ui/', output), { recursive: true });
