// Shared page chrome. The home page and the white paper both come out of this
// so the nav does not drift between them.

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function nav(current) {
  const item = (href, label, key) => {
    const here = current === key ? ' aria-current="page"' : '';
    return `<a href="${href}"${here}>${label}</a>`;
  };
  return `<nav class="site-nav" aria-label="Primary">
      ${item('/#how', 'How it works', '')}
      ${item('/#catches', 'What it catches', '')}
      ${item('/#privacy', 'Privacy', '')}
      ${item('/whitepaper', 'White paper', 'paper')}
      ${item('/#download', 'Download', '')}
    </nav>`;
}

const MARK = `<svg class="mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="currentColor"/>
      <path d="M16 7.2 9.2 10.4v6c0 3.9 2.7 6.6 6.8 7.6 4.1-1 6.8-3.7 6.8-7.6v-6z" fill="#8fd4ae"/>
      <path d="M13.1 16.3 15.2 18.4 19.2 13.8" fill="none" stroke="#1a1c16" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

export function page({ title, description, current, body, script = false }) {
  const scriptTag = script ? '<script type="module" src="/js/site.js"></script>' : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#f4f2ec" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#121410" media="(prefers-color-scheme: dark)">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/site.css">
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <header class="site-header">
    <div class="wrap header-inner">
      <a class="brand" href="/">
        ${MARK}
        <span>Lookout</span>
      </a>
      ${nav(current)}
    </div>
  </header>
  <main id="main" tabindex="-1">
    ${body}
  </main>
  <footer class="site-footer">
    <div class="wrap footer-grid">
      <div>
        <p class="footer-name">Lookout</p>
        <p>A local monitor for what AI coding agents run on your computer.</p>
      </div>
      <div>
        <p class="footer-label">Read</p>
        <ul>
          <li><a href="/whitepaper">White paper</a></li>
          <li><a href="/#faq">FAQ</a></li>
          <li><a href="/#how">How it works</a></li>
        </ul>
      </div>
      <div>
        <p class="footer-label">Code</p>
        <ul>
          <li><a href="https://github.com/alexlautin/emoryhacksf26">Source on GitHub</a></li>
          <li><a href="/whitepaper.md">White paper, markdown</a></li>
        </ul>
      </div>
    </div>
    <div class="wrap footer-end">
      <p>Built at Emory Hacks.</p>
    </div>
  </footer>
  ${scriptTag}
</body>
</html>
`;
}
