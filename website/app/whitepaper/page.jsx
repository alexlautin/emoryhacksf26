import fs from 'node:fs';
import path from 'node:path';
import { renderMarkdown } from '../../src/markdown.mjs';
export const metadata = { title: 'Lookout white paper' };
export default function Whitepaper() { return <article className="paper" dangerouslySetInnerHTML={{ __html: renderMarkdown(fs.readFileSync(path.join(process.cwd(), 'whitepaper.md'), 'utf8')) }} />; }
