import fs from 'node:fs';
import path from 'node:path';
import Downloads from './downloads.jsx';
export default function Home() {
  const html = fs.readFileSync(path.join(process.cwd(), 'src/home.html'), 'utf8');
  return <><div dangerouslySetInnerHTML={{ __html: html }} /><Downloads /></>;
}
