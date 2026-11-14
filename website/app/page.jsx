import Downloads from './downloads.jsx';
import { Pug } from './_components/brand.jsx';
import { RELEASE_PAGE, CHECKSUMS_URL } from '../releases.js';

function Hero() {
  return (
    <section className="hero">
      <div className="wrap hero-grid">
        <div className="hero-copy">
          <h1>Know what your AI coding assistant is doing.</h1>
          <p className="lead">Harness sits in your menu bar and watches Claude Code, Codex and other coding assistants. If one does something dangerous, it stops it and tells you.</p>
          <p className="hero-cta">
            <a className="btn btn-ink" href="#download">Download for Mac or Windows</a>
            <a className="btn btn-line" href="/demo">See it in action <span aria-hidden="true">→</span></a>
          </p>
          <p className="hero-note">Free. No account. Nothing leaves your computer.</p>
        </div>

        <div className="panel-wrap" aria-hidden="true">
          <Pug size={132} className="panel-pug" />
          <div className="panel">
            <div className="panel-top"><b>Harness</b><span className="live"><i />Live</span></div>
            <div className="panel-score">
              <span className="ring"><b>100</b></span>
              <p><b>All good</b><span>Nothing concerning so far.</span></p>
            </div>
            <ul className="panel-sessions">
              <li><b>Claude Code</b><span>my-app</span><em>Working</em></li>
              <li><b>Codex</b><span>api-server</span><em>Idle</em></li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function How() {
  const items = [
    { n: '1', h: 'It watches', p: 'Harness keeps an eye on everything your coding assistant does on your computer, even the parts you never see.' },
    { n: '2', h: 'It stops trouble', p: 'If something looks dangerous, like opening your passwords or sending files away, Harness pauses the assistant right away.' },
    { n: '3', h: 'You decide', p: 'You see what happened in plain words, then choose to let it continue or stop it for good.' },
  ];
  return (
    <section id="how" className="sec">
      <div className="wrap">
        <header className="sec-head" data-reveal>
          <h2>How it works</h2>
        </header>
        <ol className="respond">
          {items.map((it) => (
            <li key={it.h} data-reveal>
              <p className="respond-when">{it.n}</p>
              <h3>{it.h}</h3>
              <p>{it.p}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Privacy() {
  return (
    <section id="privacy" className="sec sec-dark">
      <div className="wrap privacy">
        <div data-reveal>
          <h2>It watches your assistant.<br />Nobody watches you.</h2>
        </div>
        <ul data-reveal>
          <li><code>On your computer</code><p>Everything Harness sees stays on your machine.</p></li>
          <li><code>No account</code><p>No sign-up and no tracking.</p></li>
        </ul>
      </div>
    </section>
  );
}

const FAQ = [
  ['Which assistants does it work with?', 'Claude Code, Codex, Gemini CLI, Cursor, Copilot, opencode and Amp.'],
  ['Does anything leave my computer?', 'No. The only exception is the demo on this website, which is a made-up session and never touches your computer.'],
  ['Does it need admin rights?', 'No. Harness runs as you. Your computer may ask you to approve it the first time you open it, and the steps are below.'],
  ['What can it miss?', 'Very fast actions can slip by. The white paper lists every limit we know about.'],
];

export default function Home() {
  return (
    <>
      <Hero />
      <How />
      <Privacy />
      <section id="faq" className="sec sec-tint">
        <div className="wrap faq-grid">
          <header className="sec-head" data-reveal>
            <h2>Questions</h2>
            <p>Want the details? Read the <a href="/whitepaper">white paper</a>.</p>
          </header>
          <div className="faq" data-reveal>
            {FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
          </div>
        </div>
      </section>
      <section id="download" className="sec dl-sec">
        <div className="wrap dl-wrap">
          <Pug size={168} className="dl-pug" />
          <h2>Get Harness</h2>
          <p className="lead">Free. Lives in your Mac menu bar or Windows system tray.</p>
          <div id="downloads" />
          <noscript><p>Downloads are listed on <a href="https://github.com/alexlautin/harness/releases/latest">GitHub Releases</a>.</p></noscript>
          <details className="install-guide">
            <summary>Need help opening it the first time?</summary>
            <p>Node is included. You do not need a developer account or a separate Node installation.</p>
            <section id="install-mac" aria-labelledby="install-mac-title">
              <h4 id="install-mac-title">On a Mac</h4>
              <p>In Apple menu → About This Mac, look for <strong>Chip</strong> (Apple silicon) or <strong>Processor</strong> (Intel) to choose your download.</p>
              <ol>
                <li>Open the downloaded DMG and drag <strong>Harness</strong> to <strong>Applications</strong>.</li>
                <li>Open Harness from Applications. This preview is not notarized, so macOS may show <strong>“Harness” Not Opened</strong> and say Apple could not verify it is free of malware. Click <strong>Done</strong>.</li>
                <li>Open <strong>System Settings → Privacy &amp; Security</strong>. Scroll to the message about Harness and click <strong>Open Anyway</strong>.</li>
                <li>Authenticate if asked, then confirm <strong>Open</strong>. Look for Harness in your <strong>menu bar</strong>; click it to open the dashboard.</li>
              </ol>
              <p>macOS saves your approval for this copy of the app. A new download may need approval again. Only approve a build you intentionally downloaded from this project’s GitHub release.</p>
              <details>
                <summary>Still cannot open it?</summary>
                <p>If Open Anyway is missing, try opening Harness from Applications again, then return to Privacy &amp; Security. On older macOS versions, look in System Preferences → Security &amp; Privacy → General. A managed Mac may require help from your administrator.</p>
                <p>If macOS says the app is damaged or contains malware, stop and download a fresh copy from the release page. If the message persists, report the exact wording and your macOS version. Avoid disabling Gatekeeper or clearing security attributes as a routine installation step.</p>
                <p><a href="https://support.apple.com/102445">Apple’s guide to opening downloaded apps</a> · <a href="https://github.com/alexlautin/harness/issues">Report an installation issue</a></p>
              </details>
            </section>
            <section id="install-windows" aria-labelledby="install-windows-title">
              <h4 id="install-windows-title">On Windows</h4>
              <p>Run the 64-bit installer. This preview is unsigned, so SmartScreen may show “Windows protected your PC.” For a build you intentionally downloaded from this project’s release, choose <strong>More info → Run anyway</strong> if available. If your organization blocks it or Windows reports malware, stop and check with your administrator or report the message.</p>
              <p>WebView2 is installed if needed. After installation, look for Harness in the <strong>system tray</strong>, including the hidden icons menu.</p>
            </section>
          </details>
          <p className="install-source"><a href={RELEASE_PAGE}>Release notes and source</a> · <a href={CHECKSUMS_URL}>SHA-256 checksums</a></p>
        </div>
      </section>
      <Downloads />
    </>
  );
}
