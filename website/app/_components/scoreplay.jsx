'use client';
import { useState } from 'react';
import { computeScore, FACTORS } from '../../lib/score.js';

// Each chip is one event, scored by the same function the app uses.
const EVENTS = [
  { id: 1, label: 'npm install', risk: 'low', reasons: ['installed packages'] },
  { id: 2, label: 'Connects to an unknown server', risk: 'medium', reasons: ["connected to a server Harness doesn't recognize"] },
  { id: 3, label: 'sudo', risk: 'medium', reasons: ['asked for administrator access'] },
  { id: 4, label: 'Adds a LaunchAgent', risk: 'high', reasons: ['set something up to run automatically'] },
  { id: 5, label: 'Uploads a file with curl', risk: 'high', reasons: ['uploaded data to a server'] },
  { id: 6, label: 'Reads a decoy key', risk: 'critical', reasons: ['touched a decoy secret'] },
];

export default function ScorePlay() {
  const [picked, setPicked] = useState([1]);
  const now = Date.now();
  const { score, level, factors } = computeScore(EVENTS.filter((e) => picked.includes(e.id)).map((e) => ({ ...e, kind: 'process', ts: now })), now);
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <div className="sp">
      <div className="sp-left">
        <p className={`sp-num lv-${level.cls}`} aria-live="polite"><b>{score}</b><span>{level.name}</span></p>
        <div className="sp-scale" aria-hidden="true">
          <i style={{ left: `${score}%` }} />
          <span style={{ flex: 40 }}>Act</span><span style={{ flex: 30 }}>Review</span><span style={{ flex: 20 }}>Steady</span><span style={{ flex: 10 }}>Clear</span>
        </div>
        <p className="sp-hint">Try it. Tap what an agent might do:</p>
        <div className="sp-chips">
          {EVENTS.map((e) => (
            <button key={e.id} type="button" aria-pressed={picked.includes(e.id)} className={`chip risk-${e.risk}`} onClick={() => toggle(e.id)}>{e.label}</button>
          ))}
        </div>
      </div>
      <ul className="sp-factors">
        {FACTORS.map((f) => {
          const lost = factors.find((x) => x.id === f.id)?.lost ?? 0;
          return (
            <li key={f.id} className={lost ? 'is-hit' : ''}>
              <span className="sp-f-name">{f.name}</span>
              <span className="sp-f-bar" style={{ '--cap': f.cap / 70 }}><i style={{ width: `${(lost / f.cap) * 100}%` }} /></span>
              <span className="sp-f-num"><em>{lost ? `−${lost}` : '0'}</em><small>/ {f.cap}</small></span>
            </li>
          );
        })}
      </ul>
      <details className="sp-how">
        <summary>How the number is calculated</summary>
        <div className="sp-how-body">
          <p>In short: 100, minus what each group has cost, never below 0.</p>
          <ol>
            <li>Every event gets a risk (low to critical) and lands in one of six groups.</li>
            <li>The group charges points by risk, per the table.</li>
            <li>Each group has a cap, so one noisy category can’t sink the score alone.</li>
            <li>Costs halve every 12 hours, so old events fade out.</li>
          </ol>
          <table>
            <thead><tr><th scope="col">Group</th><th scope="col">Critical</th><th scope="col">High</th><th scope="col">Medium</th><th scope="col">Low</th><th scope="col">Cap</th></tr></thead>
            <tbody>
              {FACTORS.map((f) => (
                <tr key={f.id}><th scope="row">{f.name}</th><td>{f.cost.critical}</td><td>{f.cost.high}</td><td>{f.cost.medium}</td><td>{f.cost.low}</td><td>{f.cap}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="sp-how-foot">Labels: 90+ Clear, 70+ Steady, 40+ Review, below 40 Act. The chips above use the app’s own scoring code. Exact formula: 100 − Σ min(cap, Σ cost × 0.5^(age ÷ 12h)).</p>
        </div>
      </details>
    </div>
  );
}
