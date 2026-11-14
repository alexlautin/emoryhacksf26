import fs from 'node:fs';
const here = new URL('./', import.meta.url);
const output = new URL('public/', here);
fs.mkdirSync(output, { recursive: true });
fs.copyFileSync(new URL('whitepaper.md', here), new URL('whitepaper.md', output));
fs.cpSync(new URL('../public/ui/', here), new URL('ui/', output), { recursive: true });
