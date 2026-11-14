import fs from 'node:fs';
fs.mkdirSync('public', { recursive: true });
fs.copyFileSync('whitepaper.md', 'public/whitepaper.md');
