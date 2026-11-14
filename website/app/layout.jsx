import '../src/site.css';
import './demo.css';
import Brand from './_components/brand.jsx';

export const metadata = {
  title: 'Harness — Know what your AI coding assistant is doing',
  description: 'Harness sits in your menu bar, watches Claude Code, Codex and other coding assistants, and stops them if they do something dangerous.',
};
export const viewport = { themeColor: '#fbfaf7' };

const GITHUB = 'https://github.com/alexlautin/harness';

export default function Layout({ children }) {
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#main">Skip to content</a>
        <header className="nav">
          <div className="wrap nav-in">
            <Brand />
            <nav className="nav-links" aria-label="Primary">
              <a href="/#how">How it works</a>
              <a href="/demo">Demo</a>
              <a href="/whitepaper">White paper</a>
            </nav>
            <a className="btn btn-ink btn-sm" href="/#download">Download</a>
          </div>
        </header>
        <main id="main" tabIndex={-1}>{children}</main>
        <footer className="foot">
          <div className="wrap foot-in">
            <div>
              <Brand />
              <p>A local monitor for AI coding agents.<br />Built at Emory Hacks, fall 2026.</p>
            </div>
            <nav aria-label="Footer">
              <a href="/#how">How it works</a>
              <a href="/demo">Demo</a>
              <a href="/whitepaper">White paper</a>
              <a href={GITHUB}>Source on GitHub</a>
              <a href="/ui/index.html">Brand kit</a>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
