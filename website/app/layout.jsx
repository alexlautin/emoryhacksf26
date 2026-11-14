import '../src/site.css';
import './demo.css';
export const metadata = { title: 'Lookout — See what your coding agent runs', description: 'Follow the chain behind an agent command. Try an interactive Gemini-powered simulation.', icons: { icon: '/favicon.svg' } };
export default function Layout({ children }) {
  return <html lang="en"><body><a className="skip" href="#main">Skip to content</a><header className="site-header"><div className="wrap header-inner"><a className="brand" href="/">◈ Lookout</a><nav className="site-nav" aria-label="Primary"><a href="/#how">How it works</a><a href="/demo">Try the demo</a><a href="/whitepaper">White paper</a><a href="/#download">Download</a></nav></div></header><main id="main" tabIndex={-1}>{children}</main><footer className="site-footer"><div className="wrap"><p className="footer-name">Lookout</p><p>A local monitor for AI coding agents. Built at Emory Hacks.</p><a href="https://github.com/alexlautin/emoryhacksf26">Source on GitHub</a> · <a href="/whitepaper">White paper</a></div></footer></body></html>;
}
