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
        <p className="sp-hint">Try it. Each of these is something an agent session can do.</p>
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
              <span className="sp-f-num">{lost ? `−${lost}` : '0'}<small> / {f.cap}</small></span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
