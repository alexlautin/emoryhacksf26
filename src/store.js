// In-memory event store + live subscribers (Server-Sent Events).
// Everything stays on this machine. Events are also appended to data/events.jsonl.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './paths.js';
import { computeScore } from '../public/score.js';
import { applyBaseline } from '../public/baseline.js';
import { listBaselines } from './baselines.js';

const LOG_FILE = path.join(DATA_DIR, 'events.jsonl');

const MAX_EVENTS = 5000;

const events = [];
const agents = new Map(); // agentId -> agent
const subscribers = new Set();
const eventListeners = new Set();
let nextId = 1;

export function broadcast(type, payload) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of subscribers) res.write(msg);
}

export function subscribe(res) {
  subscribers.add(res);
  res.on('close', () => subscribers.delete(res));
}

export function upsertAgent(agent) {
  const existing = agents.get(agent.id);
  if (existing) {
    Object.assign(existing, agent);
  } else {
    agents.set(agent.id, {
      score: 100,
      task: null,
      counts: { commands: 0, files: 0, network: 0, alerts: 0 },
      alive: true,
      ...agent,
    });
  }
  broadcast('agent', agents.get(agent.id));
  return agents.get(agent.id);
}

export function getAgent(id) {
  return agents.get(id);
}

export function listAgents() {
  return [...agents.values()];
}

/**
 * Take finished sessions off the list: one by id, or every one that has ended. A running agent is
 * never removed. Their events stay in the log and keep counting toward the score.
 */
export function clearFinishedAgents(agentId) {
  const ids = [];
  for (const a of agents.values()) {
    if (a.alive || (agentId && a.id !== agentId)) continue;
    ids.push(a.id);
  }
  for (const id of ids) agents.delete(id);
  if (ids.length) broadcast('cleared', { ids });
  return ids;
}

export function addEvent(e) {
  const agent = e.agentId ? agents.get(e.agentId) : null;
  const adjusted = applyBaseline(e, listBaselines(), agent);
  const event = { id: nextId++, ts: Date.now(), risk: 'info', reasons: [], ...adjusted };
  events.push(event);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  fs.appendFile(LOG_FILE, JSON.stringify(event) + '\n', () => {});

  if (agent) {
    agent.lastActive = event.ts;
    if (event.kind === 'process' || event.kind === 'tool') agent.counts.commands++;
    if (event.kind === 'file') agent.counts.files++;
    if (event.kind === 'network') agent.counts.network++;
    if (['high', 'critical'].includes(event.risk)) agent.counts.alerts++;
    agent.score = computeScore(events.filter((e) => e.agentId === agent.id)).score;
    broadcast('agent', agent);
  }
  broadcast('event', event);
  for (const fn of eventListeners) {
    try { fn(event); } catch (err) { console.error('[store listener]', err.message); }
  }
  return event;
}

/** Run a callback for every new event (used by the guard to auto-pause flagged agents). */
export function onEvent(fn) {
  eventListeners.add(fn);
}

export function listEvents({ agentId, limit = 500 } = {}) {
  const list = agentId ? events.filter((e) => e.agentId === agentId) : events;
  return list.slice(-limit);
}

/** Swap events in place (after a baseline change) and send the new copies to the dashboard. */
export function reviseEvents(changed) {
  if (!changed?.length) return [];
  const byId = new Map(changed.map((e) => [e.id, e]));
  const touched = new Set();
  const applied = [];
  for (let i = 0; i < events.length; i++) {
    const next = byId.get(events[i].id);
    if (!next) continue;
    events[i] = next;
    applied.push(next);
    if (next.agentId) touched.add(next.agentId);
  }
  for (const id of touched) {
    const agent = agents.get(id);
    if (!agent) continue;
    agent.score = computeScore(events.filter((e) => e.agentId === id)).score;
    broadcast('agent', agent);
  }
  for (const e of applied) broadcast('event', e);
  return applied;
}

export function clearAll() {
  events.length = 0;
  for (const a of agents.values()) {
    a.score = 100;
    a.counts = { commands: 0, files: 0, network: 0, alerts: 0 };
  }
  broadcast('reset', {});
}
