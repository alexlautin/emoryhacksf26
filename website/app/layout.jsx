import '../src/site.css';
import './demo.css';
import Brand from './_components/brand.jsx';

export const metadata = {
  title: 'Harness — Let your coding agent run. Keep it on a harness.',
  description: 'Harness watches everything Claude Code, Codex and other coding agents do on your computer, including what their window leaves out, and pauses them before something risky finishes.',
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
              <a href="/#scenario">How it works</a>
              <a href="/#watch">What it catches</a>
              <a href="/demo">Live demo</a>
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
              <a href="/#scenario">How it works</a>
              <a href="/demo">Live demo</a>
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
