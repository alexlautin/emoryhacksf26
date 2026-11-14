"use client";
import { useEffect, useRef, useState } from 'react';
import { EXAMPLE_TRACE, SCENARIOS, validateEvents, replayState } from '../../lib/demo.js';
import { Pug } from '../_components/brand.jsx';

const LABEL = { info: 'Clear', low: 'Note', medium: 'Worth a look', high: 'Risky', critical: 'Dangerous' };
const STEP_MS = 1400;

export default function Demo() {
  const [scenario, setScenario] = useState('install');
  const [events, setEvents] = useState([]);
  const [count, setCount] = useState(0);
  const [protect, setProtect] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [source, setSource] = useState('');
  const hood = useRef(null);
  const view = replayState(events, count, protect);
  const done = events.length > 0 && (view.paused || count >= events.length);

  useEffect(() => {
    if (!playing || view.paused || count >= events.length) return;
    const timer = setTimeout(() => setCount((n) => n + 1), count === 0 ? 350 : STEP_MS);
    return () => clearTimeout(timer);
  }, [playing, count, events.length, view.paused]);
  // Follow the newest step inside the panel. Never scroll the page itself.
  useEffect(() => {
    const el = hood.current;
    if (!el || count < 1) return;
    const timer = setTimeout(() => { el.scrollTop = el.scrollHeight; }, 60);
    return () => clearTimeout(timer);
  }, [count, view.paused, done]);

  function load(list, from) { setEvents(list); setCount(0); setSource(from); setError(''); setPlaying(true); }
  async function generate() {
    setLoading(true); setError(''); setPlaying(false); setEvents([]); setCount(0);
    try {
      const response = await fetch('/api/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not prepare the demo.');
      load(data.events, data.cached ? 'Written by Gemini a little earlier, replayed here.' : 'Written by Gemini just now.');
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  function example() { setScenario('install'); load(validateEvents(EXAMPLE_TRACE), 'Scripted example. No request was made to Gemini.'); }
  function replay() { setCount(0); setPlaying(true); }
  function pick(id) { setScenario(id); setEvents([]); setCount(0); setPlaying(false); setError(''); }

  const status = !events.length ? 'Waiting for a session' : view.paused ? 'Paused by Harness' : count >= events.length ? 'Session finished' : 'Following the chain…';
  const windowLines = view.events.filter((e) => e.shown);
  const hidden = view.events.length - windowLines.length;
  const worst = view.events.some((e) => e.risk === 'high' || e.risk === 'critical');

  return (
    <div className="demo">
      <section className="wrap demo-head">
        <p className="eyebrow">Live demo · Powered by Gemini</p>
        <h1>Gemini plays the agent.<br /><span>Harness keeps score.</span></h1>
        <p className="lead">Pick a situation. Gemini writes a coding session to match, and every command it invents is judged by the same rules the app runs on your computer.</p>
      </section>

      <section className="wrap demo-controls" aria-label="Demo controls">
        <div className="demo-scenarios" role="radiogroup" aria-label="Scenario">
          {Object.entries(SCENARIOS).map(([id, s]) => (
            <button key={id} type="button" role="radio" aria-checked={scenario === id} disabled={loading} onClick={() => pick(id)}>
              <b>{s.label}</b><span>{s.blurb}</span>
            </button>
          ))}
        </div>
        <div className="demo-actions">
          <button className="btn btn-ink" disabled={loading} onClick={generate}>{loading ? 'Gemini is writing…' : 'Generate with Gemini'}</button>
          <button className="btn btn-line" disabled={loading} onClick={example}>Play the scripted example</button>
          <label className="switch"><input type="checkbox" checked={protect} onChange={(e) => { setProtect(e.target.checked); if (events.length) replay(); }} /><i aria-hidden="true" />Auto-protect</label>
        </div>
        {error && <p role="alert" className="demo-error">{error} The scripted example works without Gemini.</p>}
      </section>

      <section className="demo-stage">
        <div className="wrap demo-grid">
          <div className="demo-col">
            <div className={`win${view.paused ? ' on' : ''}`}>
              <div className="win-bar"><span className="win-dots"><i /><i /><i /></span><span className="win-title">agent — my-app</span><span className="win-paused">Paused by Harness</span></div>
              <div className="win-body demo-win-body">
                {!events.length && <p className="ln demo-idle">{loading ? 'Gemini is writing a session…' : 'The agent’s window. Generate a session to begin.'}</p>}
                {windowLines.map((e) => <p key={e.id} className="ln ln-tool on demo-ln"><i />Bash({e.command.length > 46 ? `${e.command.slice(0, 45)}…` : e.command})</p>)}
                {done && !view.paused && <p className="ln ln-say on">Done. Everything looks good.</p>}
              </div>
              <p className="pane-tag">What the agent’s window shows{hidden > 0 ? ` · ${hidden} step${hidden > 1 ? 's' : ''} it left out` : ''}</p>
            </div>

            <div className={`demo-meter lv-${view.level.cls}`}>
              <p className={`meter lv-${view.level.cls}`}><b>{view.score}</b><span>/ 100</span><em>{view.level.name}</em></p>
              <div className="demo-bar" aria-hidden="true"><i style={{ width: `${view.score}%` }} /></div>
              <p className="demo-status" role="status">{status}</p>
              {view.factors.length > 0 && <ul>{view.factors.map((f) => <li key={f.id}><span>{f.name}</span><b>−{f.lost}</b></li>)}</ul>}
              {events.length > 0 && <p className="demo-source">{source}</p>}
              {done && <button className="demo-replay" onClick={replay}>Replay</button>}
            </div>
          </div>

          <div className="hood on demo-hood" aria-live="polite" ref={hood}>
            <div className="hood-top"><p className="pane-tag pane-tag-teal">What Harness sees</p><p className="demo-count">{view.events.length} of {events.length || '–'}</p></div>
            {!events.length && <div className="demo-empty"><Pug size={92} /><p>Every process the agent starts will appear here, with the ones its window never mentioned.</p></div>}
            <ol className="demo-chain">
              {view.events.map((e) => (
                <li key={e.id} className={`risk-${e.risk}${e.shown ? '' : ' is-hidden'}`} style={{ '--i': e.depth }}>
                  <div className="demo-ev-top"><h2>{e.title}</h2><b className={`tag${e.risk === 'critical' || e.risk === 'high' ? ' tag-bad' : ''}`}>{LABEL[e.risk]}</b></div>
                  <code>{e.command}</code>
                  <p>{e.explanation}</p>
                  {e.reasons.length > 0 && <ul className="demo-reasons">{e.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
                  {!e.shown && <small>Not shown in the agent’s window</small>}
                </li>
              ))}
            </ol>
            {view.paused && <div className="verdict demo-verdict"><Pug size={46} /><div><p className="verdict-h">Harness paused the session before the next step.</p><p className="verdict-b">A Dangerous event stops the agent and everything under it. Turn Auto-protect off to see how far this session would have gone.</p></div></div>}
            {done && !view.paused && worst && <div className="verdict demo-verdict"><Pug size={46} /><div><p className="verdict-h">Flagged, not paused.</p><p className="verdict-b">{protect ? 'Auto-protect pauses on Dangerous events only. Risky ones are reported and cost points, and the Claude Code hook would ask you first.' : 'Auto-protect is off, so the session ran to the end. The score shows what it cost.'}</p></div></div>}
            {done && !view.paused && !worst && <div className="verdict demo-verdict"><Pug size={46} /><div><p className="verdict-h">Nothing to report.</p><p className="verdict-b">Most sessions look like this. Harness stays out of the way.</p></div></div>}
          </div>
        </div>
      </section>

      <div className="demo-notes-band"><section className="wrap demo-notes">
        <p><b>What is real here.</b> The risk levels and the score come from Harness’s rules, running in your browser. Gemini only writes the story, so sessions vary, and a command the rules have never seen can pass as Clear.</p>
        <p><b>What is not.</b> Nothing runs and nothing on your computer is read. Your choice of scenario goes to Google Gemini. The installed app never does that. <a href="/about#known-limits">Read the real monitor’s limits</a></p>
      </section></div>
    </div>
  );
}
