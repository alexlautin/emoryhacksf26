// The Harness pug: the brand pug from the landing page, brought to life above the safety score.
//
// The art is the same image the landing page uses (public/ui/pug.png), untouched. It is drawn
// twice inside one SVG: the whole dog, then just the head (clipped out of the same image) so the
// head can tilt and nod. Everything else is posture: breathing, crouching, leaning, hops and a
// tremble. A requestAnimationFrame loop eases every value toward the pose for the current mood
// (critically damped, so nothing snaps), and springs add the hops and head jerks.
//
// Moods, from the score and the agents:
//   asleep   no agents running and nothing wrong: head down, slow deep breaths, z's
//   happy    score Clear and an agent is working: a little prance, head bobbing
//   content  score Clear or Steady: easy breathing
//   alert    score Review: stands taller, head up
//   worried  score Act: crouched, head low, leaning back, a slight tremble
//   guard    Harness paused an agent: braced and leaning in, head up, a short bark now and then
//   wary     part of Harness stopped watching: standing tall, ears up, quick shallow breaths
//   lost     the dashboard lost contact with Harness: head hung low, waiting
// Reactions: a startle when the score gets worse, a happy hop when it recovers, a hop when you
// click it, a perk-up when a new agent starts, a slow nod when one finishes, a head tilt at
// something worth a look, and a bark when Harness blocks an action before it runs. With reduced motion it holds each pose and skips the movement.

const NS = 'http://www.w3.org/2000/svg';
const SRC = '/ui/pug.png';
const W = 1316;
const H = 1195;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
const RANK = { loading: 0, clear: 1, steady: 2, review: 3, act: 4 };

// Image-space geometry (pixels of pug.png).
const FEET = [600, 1188];
const HEAD_PIVOT = [820, 540];
const HEAD_CLIP = '575,470 560,300 600,170 700,92 900,70 1080,108 1200,168 1292,238 1302,380 1232,472 1120,522 1060,562 1040,592 650,456';

//          crouch lean  head  bounce bob  tremble zz  bark breathHz breathAmp
const MOODS = {
  loading: [0,     0,    0,    0,     0,   0,      0,  0,   0.35,    1],
  asleep:  [0.05,  0,    7,    0,     0,   0,      1,  0,   0.22,    2.2],
  happy:   [0,     0.6, -1.5,  1,     1,   0,      0,  0,   0.6,     1.2],
  content: [0,     0,    0,    0,     0,   0,      0,  0,   0.32,    1],
  alert:   [-0.025,0.4, -4.5,  0,     0,   0,      0,  0,   0.45,    0.8],
  worried: [0.06, -1.6,  4.5,  0,     0,   1,      0,  0,   0.7,     0.8],
  guard:   [0.025, 1.8, -2.5,  0,     0,   0,      0,  1,   0.5,     0.9],
  wary:    [-0.03, 0.9, -5.5,  0,     0,   0,      0,  0,   0.6,     0.6],
  lost:    [0.04, -0.6,  8,    0,     0,   0,      0,  0,   0.25,    1.4],
};
const KEYS = ['crouch', 'lean', 'head', 'bounce', 'bob', 'tremble', 'zz', 'bark', 'breathHz', 'breathAmp'];
const pose = (name) => Object.fromEntries(KEYS.map((k, i) => [k, MOODS[name][i]]));
const TITLES = {
  loading: 'Waking up', asleep: 'Asleep. No agents running.', happy: 'Happy. Everything looks fine.',
  content: 'Relaxed', alert: 'Keeping an eye on things', worried: 'Worried. Something dangerous happened.',
  guard: 'On guard. An agent is paused until you decide.',
  wary: 'Uneasy. Part of Harness isn’t watching right now.',
  lost: 'Lost contact with Harness. Trying again.',
};

const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};

let root = null;
let parts = null;
let mood = 'loading';
let last = { rank: 0, paused: false };
const p = pose('loading');
let target = pose('loading');
const spring = { hop: 0, hopV: 0, squash: 0, squashV: 0, nod: 0, nodV: 0 };
const fx = { bang: 0, bark: 0 };
const pointer = { y: 0, at: -1e9 };
const phase = { breath: 0, bounce: 0, z: 0 };
let barkAt = 0;
let lastT = 0;
let tilt = 0;

function build(host) {
  const svg = el('svg', { viewBox: '-80 -230 1480 1480', class: 'pug-svg', role: 'presentation', focusable: 'false' });
  const defs = el('defs', {}, svg);
  const hc = el('clipPath', { id: 'pug-head-clip' }, defs);
  el('polygon', { points: HEAD_CLIP }, hc);

  const shadow = el('ellipse', { cx: FEET[0], cy: FEET[1] + 6, rx: 470, ry: 30, fill: 'var(--pug-shadow)' }, svg);
  const all = el('g', {}, svg);
  el('image', { href: SRC, width: W, height: H }, all);
  const head = el('g', {}, all);
  el('image', { href: SRC, width: W, height: H, 'clip-path': 'url(#pug-head-clip)' }, head);

  // Startle mark, bark lines and sleep z's.
  const bang = el('g', { opacity: 0 }, svg);
  el('rect', { x: -26, y: -170, width: 52, height: 118, rx: 26, fill: 'var(--pug-alert)' }, bang);
  el('circle', { cx: 0, cy: 0, r: 28, fill: 'var(--pug-alert)' }, bang);
  const barkG = el('g', { opacity: 0, fill: 'none', stroke: 'var(--pug-z)', 'stroke-width': 22, 'stroke-linecap': 'round' }, svg);
  for (const r of [70, 125, 180]) el('path', { d: `M${r * 0.5} ${-r * 0.86} A${r} ${r} 0 0 1 ${r * 0.5} ${r * 0.86}` }, barkG);
  const zs = [0, 1, 2].map(() => el('path', { d: 'M0 0 h62 l-62 62 h62', fill: 'none', stroke: 'var(--pug-z)', 'stroke-width': 18, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0 }, svg));

  host.appendChild(svg);
  return { svg, shadow, all, head, bang, barkG, zs };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (cur, to, dt, rate) => cur + (to - cur) * (1 - Math.exp(-dt * rate));
const f = (n) => Math.round(n * 100) / 100;

function stepSpring(key, vKey, to, dt, k, c) {
  spring[vKey] += ((to - spring[key]) * k - spring[vKey] * c) * dt;
  spring[key] += spring[vKey] * dt;
}

function frame(now) {
  if (!parts) return;
  const dt = Math.min(0.05, lastT ? (now - lastT) / 1000 : 0.016);
  lastT = now;
  const still = REDUCED.matches;
  const t = now / 1000;

  for (const k of KEYS) p[k] = still ? target[k] : ease(p[k], target[k], dt, k === 'breathHz' ? 2 : 5);
  fx.bang = ease(fx.bang, 0, dt, 1.5);
  fx.bark = ease(fx.bark, 0, dt, 3.5);

  phase.breath += dt * Math.PI * 2 * p.breathHz;
  phase.bounce += dt * Math.PI * 2 * 0.75;
  phase.z += dt * 0.5;
  const breath = still ? 0 : Math.sin(phase.breath);

  // A short bark every couple of seconds while on guard: the head snaps up and sound lines pop.
  if (!still && p.bark > 0.6 && now - barkAt > 2600) {
    barkAt = now;
    spring.nodV -= 70;
    spring.hopV += 30;
    fx.bark = 1;
  }

  stepSpring('hop', 'hopV', 0, dt, 240, 15);
  stepSpring('squash', 'squashV', 0, dt, 380, 17);
  stepSpring('nod', 'nodV', 0, dt, 200, 13);

  // A happy prance: small regular hops, with the head bobbing a beat behind.
  const beat = Math.max(0, Math.sin(phase.bounce)) ** 2;
  const prance = still ? 0 : p.bounce * beat * 26;
  const bob = still ? 0 : p.bob * Math.sin(phase.bounce - 0.9) * 2.2;

  // Head follows the pointer a little: up when it's above, down when it's below.
  let want = 0;
  if (now - pointer.at < 2600 && p.zz < 0.5) {
    const r = parts.svg.getBoundingClientRect();
    want = clamp((pointer.y - (r.top + r.height * 0.3)) / 300, -1, 1) * 2.5;
  }
  tilt = still ? 0 : ease(tilt, want, dt, 4);

  // Whole dog: hop, squash and stretch from the feet, crouch, lean, tremble.
  const tremble = still ? 0 : p.tremble * (Math.sin(t * 59) * 4 + Math.sin(t * 37) * 3);
  const hop = spring.hop + prance;
  const sq = clamp(spring.squash, -0.16, 0.16);
  const sy = 1 - p.crouch - sq + breath * 0.006 * p.breathAmp;
  const sx = 1 + p.crouch * 0.4 + sq * 0.8;
  parts.all.setAttribute('transform',
    `translate(${f(tremble)} ${f(-hop)}) rotate(${f(p.lean)} ${FEET[0]} ${FEET[1]}) translate(${FEET[0]} ${FEET[1]}) scale(${f(sx)} ${f(sy)}) translate(${-FEET[0]} ${-FEET[1]})`);
  const lift = clamp(1 - hop / 260, 0.5, 1);
  parts.shadow.setAttribute('rx', f(470 * lift));
  parts.shadow.setAttribute('opacity', f(0.45 + 0.55 * lift));

  // Head: mood angle, a nod spring, the breath, the prance bob, and a lean toward the pointer.
  const headAng = p.head + spring.nod * 0.1 + tilt + bob + breath * 0.5 * p.breathAmp;
  parts.head.setAttribute('transform', `rotate(${f(headAng)} ${HEAD_PIVOT[0]} ${HEAD_PIVOT[1]})`);

  parts.bang.setAttribute('opacity', f(clamp(fx.bang * 1.6, 0, 1)));
  parts.bang.setAttribute('transform', `translate(1190 ${f(40 - hop)}) scale(${f(0.7 + Math.min(fx.bang, 0.6) * 0.6)}) rotate(14)`);

  parts.barkG.setAttribute('opacity', f(clamp(fx.bark * 1.4, 0, 1) * 0.9));
  parts.barkG.setAttribute('transform', `translate(1290 ${f(330 - hop)}) scale(${f(0.8 + (1 - fx.bark) * 0.5)})`);

  parts.zs.forEach((z, i) => {
    const k = (phase.z + i / 3) % 1;
    const vis = p.zz * (still ? (i === 0 ? 1 : 0) : Math.sin(k * Math.PI));
    z.setAttribute('opacity', f(clamp(vis, 0, 1) * 0.85));
    z.setAttribute('transform', `translate(${f(1180 + k * 120 + Math.sin(k * 6) * 20)} ${f(150 - k * 300)}) scale(${f(0.7 + k * 0.6)})`);
  });

  requestAnimationFrame(frame);
}

function react(kind) {
  if (!parts) return;
  if (REDUCED.matches) {
    if (kind === 'startle') fx.bang = 1;
    if (kind === 'bark') fx.bark = 1;
    return;
  }
  if (kind === 'startle') {
    spring.hopV += 900; spring.squashV -= 3; spring.nodV -= 90;
    fx.bang = 1;
  } else if (kind === 'better') {
    spring.hopV += 600; spring.squashV -= 2;
  } else if (kind === 'pet') {
    spring.hopV += 480; spring.squashV -= 1.6; spring.nodV += 40;
  } else if (kind === 'greet') {
    // A new agent showed up: ears up and a small hop.
    spring.hopV += 380; spring.squashV -= 1.2; spring.nodV -= 60;
  } else if (kind === 'bye') {
    // An agent finished: one slow nod.
    spring.nodV += 55;
  } else if (kind === 'notice') {
    // Something worth a look: the head snaps up, no hop.
    spring.nodV -= 75;
  } else if (kind === 'bark') {
    // Harness blocked something before it ran.
    barkAt = performance.now();
    spring.nodV -= 80; spring.hopV += 160;
    fx.bark = 1;
  }
}

export function mountPug(host) {
  if (!host || parts) return;
  root = host;
  parts = build(host);
  host.title = TITLES.loading;
  host.addEventListener('click', () => react('pet'));
  window.addEventListener('pointermove', (e) => { pointer.y = e.clientY; pointer.at = performance.now(); }, { passive: true });
  requestAnimationFrame(frame);
}

/** One-off reactions to things that just happened: 'greet', 'bye', 'notice', 'bark'. */
export function pugReact(kind) {
  if (['greet', 'bye', 'notice', 'bark'].includes(kind)) react(kind);
}

/** Called on every render with the latest score and agent state. Cheap when nothing changed. */
export function setPugMood({ level = 'loading', paused = false, working = false, agents = 0, lost = false, unwatched = false } = {}) {
  if (!parts) return;
  let next;
  if (lost) next = 'lost';
  else if (level === 'loading') next = 'loading';
  else if (paused) next = 'guard';
  else if (level === 'act') next = 'worried';
  else if (unwatched) next = 'wary';
  else if (level === 'review') next = 'alert';
  else if (!agents) next = 'asleep';
  else if (level === 'clear' && working) next = 'happy';
  else next = 'content';

  const rank = RANK[level] ?? 0;
  if (last.rank && rank > last.rank) react('startle');
  else if (last.rank && rank < last.rank && rank) react('better');
  if (paused && !last.paused) react('startle');
  last = { rank, paused };

  if (next !== mood) {
    mood = next;
    target = pose(next);
    root.title = TITLES[next];
    root.dataset.mood = next;
  }
}
