import fs from 'node:fs';
import path from 'node:path';
import { renderMarkdown } from '../../src/markdown.mjs';
export const metadata = { title: 'About Harness' };
export default function About() { return <article className="paper" dangerouslySetInnerHTML={{ __html: renderMarkdown(fs.readFileSync(path.join(process.cwd(), 'about.md'), 'utf8')) }} />; }
