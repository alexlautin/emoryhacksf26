// "What did this agent touch?" Built only from events Harness already recorded.

const RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

function uniq(list, key) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const k = key(item);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function sessionTouch(agent, events) {
  const mine = (events || []).filter((e) => e.agentId === agent?.id);
  const commands = uniq(
    mine.filter((e) => e.command && e.kind !== 'system').map((e) => ({ command: e.command, risk: e.risk, baseline: !!e.baseline })),
    (c) => c.command,
  );
  const files = [];
  for (const e of mine) {
    if (e.kind !== 'file') continue;
    if (e.path) files.push({ path: e.path, bait: !!e.bait });
    for (const f of e.files || []) files.push({ path: f, bait: false });
  }
  const fileList = uniq(files, (f) => f.path);
  const hosts = uniq(
    mine.filter((e) => e.kind === 'network' && e.host).map((e) => ({
      host: e.host,
      trusted: !!e.trusted,
      risk: e.risk,
    })),
    (h) => h.host,
  );
  const blocked = mine.filter((e) => e.gate === 'deny' || e.prevented).map((e) => e.title);
  const asked = mine.filter((e) => e.gate === 'ask').map((e) => e.title);
  const decoyCount = mine.filter((e) => e.bait || (e.reasons || []).some((r) => /decoy secret/.test(r))).length;
  const riskyCount = mine.filter((e) => e.kind !== 'system' && e.kind !== 'task' && !e.baseline && (RANK[e.risk] ?? 0) >= 2).length;

  const who = `${agent?.label || 'The agent'} in ${agent?.project || 'an unknown folder'}`;
  const parts = [];
  if (commands.length) parts.push(`ran ${plural(commands.length, 'command')}`);
  if (fileList.length) parts.push(`touched ${plural(fileList.length, 'file')}`);
  if (hosts.length) parts.push(`contacted ${plural(hosts.length, 'server')}`);
  const did = parts.length ? parts.join(', ') : 'left no record of commands, files, or servers';
  let extra = decoyCount ? ' It opened a decoy secret.' : ' It did not open a decoy secret.';
  if (blocked.length) extra += ` Harness blocked ${plural(blocked.length, 'action')} before they ran.`;
  else if (asked.length) extra += ` Harness asked you before ${plural(asked.length, 'action')}.`;
  if (agent?.paused) extra += ' The session is paused.';
  else if (agent && !agent.alive && agent.endedBy) extra += ' The session was ended.';
  else if (agent && !agent.alive) extra += ' The session has finished.';

  return {
    headline: `${who} ${did}.${extra}`,
    commands,
    files: fileList,
    hosts,
    blocked,
    asked,
    decoyCount,
    riskyCount,
    finished: agent ? !agent.alive : false,
  };
}
