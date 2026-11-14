import fs from 'node:fs';
fs.mkdirSync('public', { recursive: true });
for (const [from, to] of [['src/favicon.svg','favicon.svg'],['whitepaper.md','whitepaper.md']]) fs.copyFileSync(from, `public/${to}`);
