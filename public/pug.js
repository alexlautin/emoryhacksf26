// The Harness pug: a small companion above the safety score that shows how things are going.
//
// It is one inline SVG driven by a requestAnimationFrame loop. Each frame, every part of the face
// eases toward the pose for the current mood (critically damped, so nothing overshoots or snaps),
// and a few springs add life: a hop, ear flops, the tail. Nothing here is a canned animation file.
//
// Moods, from the score and the agents:
//   asleep   no agents running and nothing wrong
//   happy    score Clear and an agent is working: tongue out, tail going
//   content  score Clear or Steady
//   alert    score Review: ears up, looking around
//   worried  score Act: brows up, ears back, a slight tremble
//   guard    Harness paused an agent: ears forward, brows set, chest out
// Reactions: a startle when the score gets worse, a happy wiggle when it gets better,
// and a squint and wag when you click it. With reduced motion it only changes expression.

const NS = 'http://www.w3.org/2000/svg';
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
const RANK = { loading: 0, clear: 1, steady: 2, review: 3, act: 4 };

const MOODS = {
  //        eyes  arc  arcA  smile  open  tongue browT browL earUp  wag  wagHz  tuck  eyeS  tremble chest zz  look
  loading: [0.55, 0,   0,    0,     0,    0,     0,    0,    0,     0,   1,     0,    1,    0,      0,    0,  0.3],
  asleep:  [0,    -1,  1,    0.25,  0,    0,     0,    0,   -0.35,  0,   1,     0,    1,    0,      0,    1,  0],
  happy:   [1,    0,   0,    1,     0.6,  1,     0,    0.3,  0.15,  1,   3.4,   0,    1,    0,      0,    0,  0.5],
  content: [1,    0,   0,    0.65,  0,    0,     0,    0.1,  0,     0.4, 1.6,   0,    1,    0,      0,    0,  0.6],
  alert:   [1,    0,   0,   -0.05,  0,    0,     0,    0.7,  0.75,  0,   1,     0,    1.07, 0,      0.01, 0,  1],
  worried: [1,    0,   0,   -0.85,  0.22, 0,    -1,    0.5, -0.7,   0,   1,     1,    1.12, 1,      0,    0,  0.8],
  guard:   [1,    0,   0,   -0.35,  0,    0,     1,    0,    1,     0,   1,     0,    1.02, 0,      0.035,0,  0.15],
};
const KEYS = ['eyes', 'arc', 'arcA', 'smile', 'open', 'tongue', 'browT', 'browL', 'earUp', 'wag', 'wagHz', 'tuck', 'eyeS', 'tremble', 'chest', 'zz', 'look'];
const pose = (name) => Object.fromEntries(KEYS.map((k, i) => [k, MOODS[name][i]]));
const TITLES = {
  loading: 'Waking up', asleep: 'Asleep. No agents running.', happy: 'Happy. Everything looks fine.',
  content: 'Relaxed', alert: 'Keeping an eye on things', worried: 'Worried. Something dangerous happened.',
  guard: 'On guard. An agent is paused until you decide.',
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
const p = pose('loading'); // current, eased
let target = pose('loading');
const spring = { hop: 0, hopV: 0, ear: 0, earV: 0, squash: 0, squashV: 0 };
const fx = { bang: 0, squint: 0, squintUntil: 0, wagBoost: 0, wide: 0 };
const gaze = { x: 0, y: 0, tx: 0, ty: 0, next: 0 };
const pointer = { x: 0, y: 0, at: -1e9 };
const blink = { next: 0, t: -1, double: false };
let lastT = 0;
let phase = { breath: 0, wag: 0, pant: 0, z: 0 };

function build(host) {
  const svg = el('svg', { viewBox: '0 0 160 120', class: 'pug-svg', role: 'presentation', focusable: 'false' });
  const ink = 'var(--pug-ink)';
  const fawn = 'var(--pug-fawn)';
  const stroke = { stroke: ink, 'stroke-width': 3.4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' };

  const shadow = el('ellipse', { cx: 80, cy: 113, rx: 33, ry: 3.6, fill: 'var(--pug-shadow)' }, svg);
  const all = el('g', {}, svg);

  // Tail, behind the body, pivoting at its base.
  const tail = el('g', {}, all);
  el('path', { d: 'M103 92 C114 90 121 82 118 74 C115 67 105 67 104 74 C103 79 109 81 111 77', fill: 'none', stroke: ink, 'stroke-width': 10, 'stroke-linecap': 'round' }, tail);
  el('path', { d: 'M103 92 C114 90 121 82 118 74 C115 67 105 67 104 74 C103 79 109 81 111 77', fill: 'none', stroke: fawn, 'stroke-width': 4.4, 'stroke-linecap': 'round' }, tail);

  // Body and front paws.
  const body = el('g', {}, all);
  el('path', { d: 'M51 113 C49 93 59 77 80 76 C101 77 111 93 109 113 Z', fill: fawn, ...stroke }, body);
  el('path', { d: 'M62 113 V103 C62 99 70 99 70 103 V113', fill: fawn, ...stroke }, body);
  el('path', { d: 'M90 113 V103 C90 99 98 99 98 103 V113', fill: fawn, ...stroke }, body);
  el('path', { d: 'M66 113 v-4 M94 113 v-4', stroke: ink, 'stroke-width': 1.8, 'stroke-linecap': 'round', opacity: 0.6 }, body);
  // Harness: a teal vest band with a darker buckle, like the logo.
  el('path', { d: 'M55 91 C66 98 94 98 105 91 L107.5 99.5 C95 106.5 65 106.5 52.5 99.5 Z', fill: 'var(--pug-teal)', ...stroke, 'stroke-width': 2.6 }, body);
  el('rect', { x: 75.5, y: 95.5, width: 9, height: 7.5, rx: 1.8, fill: 'var(--pug-teal-deep)', stroke: ink, 'stroke-width': 2 }, body);

  // Head, tilting at the neck.
  const head = el('g', {}, all);
  el('path', { d: 'M80 17 C105 17 117 32 117 50 C117 69 101 81 80 81 C59 81 43 69 43 50 C43 32 55 17 80 17 Z', fill: fawn, ...stroke }, head);
  const wrinkles = el('path', { d: 'M72 26.5 q8 -3.4 16 0 M74.5 30.5 q5.5 -2.4 11 0', fill: 'none', stroke: ink, 'stroke-width': 1.9, 'stroke-linecap': 'round', opacity: 0.5 }, head);
  // Folded ears over the top corners of the head, each pivoting where it joins.
  const earL = el('g', {}, head);
  const earR = el('g', {}, head);
  const ear = 'M55 20.5 C46 18.5 37.5 23 36 30.5 C34.8 37 37.5 42.5 42 43 C46 41 50.5 35.5 57.5 30.5 Z';
  el('path', { d: ear, fill: 'var(--pug-ear)', ...stroke }, earL);
  el('path', { d: ear, fill: 'var(--pug-ear)', ...stroke, transform: 'translate(160 0) scale(-1 1)' }, earR);

  // Brows: two short dark marks; mirrored so one value moves both.
  const browL = el('path', { d: 'M59.5 34 q6 -2.4 12 -0.4', fill: 'none', stroke: ink, 'stroke-width': 2.6, 'stroke-linecap': 'round' }, head);
  const browR = el('path', { d: 'M88.5 33.6 q6 -2 12 0.4', fill: 'none', stroke: ink, 'stroke-width': 2.6, 'stroke-linecap': 'round' }, head);

  // Eyes: open eyes scale shut to blink; the arcs stand in for squinting or sleeping.
  const eyeL = el('g', {}, head);
  const eyeR = el('g', {}, head);
  for (const [g, cx] of [[eyeL, 65], [eyeR, 95]]) {
    el('circle', { cx, cy: 44, r: 6.2, fill: ink }, g);
    el('circle', { cx: cx - 1.9, cy: 41.9, r: 1.85, fill: '#fff' }, g);
    el('circle', { cx: cx + 2.1, cy: 46.1, r: 0.8, fill: '#fff', opacity: 0.7 }, g);
  }
  const arcL = el('path', { fill: 'none', stroke: ink, 'stroke-width': 2.6, 'stroke-linecap': 'round' }, head);
  const arcR = el('path', { fill: 'none', stroke: ink, 'stroke-width': 2.6, 'stroke-linecap': 'round' }, head);

  // Muzzle, nose and mouth.
  el('path', { d: 'M80 52.5 C93 52.5 100.5 58.5 100.5 66.5 C100.5 74.5 91.5 79.5 80 79.5 C68.5 79.5 59.5 74.5 59.5 66.5 C59.5 58.5 67 52.5 80 52.5 Z', fill: 'var(--pug-mask)', ...stroke, 'stroke-width': 2.6 }, head);
  el('path', { d: 'M71 56.5 q9 -4 18 0', fill: 'none', stroke: ink, 'stroke-width': 1.7, 'stroke-linecap': 'round', opacity: 0.7 }, head);
  el('path', { d: 'M73.6 59.6 q6.4 -3.9 12.8 0 q-1.1 5.5 -6.4 6.4 q-5.3 -0.9 -6.4 -6.4 Z', fill: ink }, head);
  el('ellipse', { cx: 78, cy: 60.2, rx: 1.6, ry: 0.85, fill: '#fff', opacity: 0.35 }, head);
  const mouthFill = el('path', { fill: 'var(--pug-mouth)' }, head);
  const tongue = el('path', { fill: 'var(--pug-tongue)', stroke: ink, 'stroke-width': 1.6 }, head);
  const mouth = el('path', { fill: 'none', stroke: ink, 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, head);

  // Startle mark and sleep z's.
  const bang = el('g', { opacity: 0 }, svg);
  el('rect', { x: -2.3, y: -15, width: 4.6, height: 10.5, rx: 2.3, fill: 'var(--pug-alert)' }, bang);
  el('circle', { cx: 0, cy: 0, r: 2.5, fill: 'var(--pug-alert)' }, bang);
  const zs = [0, 1, 2].map(() => el('path', { d: 'M0 0 h5.5 l-5.5 5.5 h5.5', fill: 'none', stroke: 'var(--pug-z)', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0 }, svg));

  host.appendChild(svg);
  return { svg, shadow, all, tail, body, head, earL, earR, wrinkles, browL, browR, eyeL, eyeR, arcL, arcR, mouth, mouthFill, tongue, bang, zs };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (cur, to, dt, rate) => cur + (to - cur) * (1 - Math.exp(-dt * rate));
const smooth = (x) => x * x * (3 - 2 * x);
const f = (n) => Math.round(n * 100) / 100;

function stepSpring(key, vKey, to, dt, k, c) {
  const a = (to - spring[key]) * k - spring[vKey] * c;
  spring[vKey] += a * dt;
  spring[key] += spring[vKey] * dt;
}

function frame(now) {
  if (!parts) return;
  const dt = Math.min(0.05, lastT ? (now - lastT) / 1000 : 0.016);
  lastT = now;
  const still = REDUCED.matches;
  const t = now / 1000;

  for (const k of KEYS) p[k] = still ? target[k] : ease(p[k], target[k], dt, k === 'wagHz' ? 2 : 7);
  fx.wide = ease(fx.wide, 0, dt, 2.2);
  fx.wagBoost = ease(fx.wagBoost, 0, dt, 1.4);
  const squintOn = now < fx.squintUntil ? 1 : 0;
  fx.squint = still ? squintOn : ease(fx.squint, squintOn, dt, 12);
  fx.bang = ease(fx.bang, 0, dt, 1.6);

  // Continuous motion
  const sleeping = p.zz > 0.5;
  phase.breath += dt * (sleeping ? 1.6 : 2.6 + p.open * 3);
  phase.wag += dt * Math.PI * 2 * (p.wagHz + fx.wagBoost * 2);
  phase.pant += dt * 9;
  phase.z += dt * 0.55;
  const breath = still ? 0 : Math.sin(phase.breath);
  const tremble = still ? 0 : p.tremble * (Math.sin(t * 61) * 0.35 + Math.sin(t * 37) * 0.25);

  // Springs: hop and ears
  stepSpring('hop', 'hopV', 0, dt, 260, 16);
  stepSpring('squash', 'squashV', 0, dt, 420, 18);
  stepSpring('ear', 'earV', p.earUp, dt, 160, 11);

  // Gaze: follow the pointer for a moment after it moves, otherwise look around now and then.
  if (now - pointer.at < 2600 && !sleeping) {
    const r = parts.svg.getBoundingClientRect();
    gaze.tx = clamp((pointer.x - (r.left + r.width / 2)) / 260, -1, 1);
    gaze.ty = clamp((pointer.y - (r.top + r.height * 0.4)) / 260, -1, 1);
  } else if (now > gaze.next) {
    const range = p.look;
    gaze.tx = (Math.random() * 2 - 1) * range;
    gaze.ty = (Math.random() * 1.4 - 0.5) * range * 0.7;
    if (Math.random() < 0.35) { gaze.tx = 0; gaze.ty = 0; }
    gaze.next = now + (p.look > 0.9 ? 700 + Math.random() * 1400 : 1600 + Math.random() * 3200);
  }
  if (sleeping) { gaze.tx = 0; gaze.ty = 0; }
  gaze.x = still ? gaze.tx : ease(gaze.x, gaze.tx, dt, 9);
  gaze.y = still ? gaze.ty : ease(gaze.y, gaze.ty, dt, 9);

  // Blinks: every few seconds, sometimes twice.
  if (!still && blink.t < 0 && now > blink.next) { blink.t = 0; blink.double = Math.random() < 0.18; }
  let lid = 1;
  if (blink.t >= 0) {
    blink.t += dt;
    const d = 0.15;
    const x = blink.t / d;
    lid = x < 0.5 ? 1 - smooth(x * 2) : smooth((x - 0.5) * 2);
    if (blink.t >= d) {
      if (blink.double) { blink.double = false; blink.t = -1; blink.next = now + 90; }
      else { blink.t = -1; blink.next = now + 2200 + Math.random() * 3800; }
      lid = 1;
    }
  }

  // Whole body: hop, squash and stretch from the ground, a breath.
  const hop = spring.hop;
  const sq = clamp(spring.squash, -0.18, 0.18);
  parts.all.setAttribute('transform', `translate(${f(tremble)} ${f(-hop)}) translate(80 113) scale(${f(1 + sq)} ${f(1 - sq)}) translate(-80 -113)`);
  const sh = clamp(1 - hop / 40, 0.55, 1);
  parts.shadow.setAttribute('rx', f(33 * sh));
  parts.shadow.setAttribute('opacity', f(0.5 + 0.5 * sh));

  const chest = 1 + p.chest + breath * 0.012;
  parts.body.setAttribute('transform', `translate(80 113) scale(${f(1 + p.chest * 0.6)} ${f(chest)}) translate(-80 -113)`);

  // Head: bob with the breath, tilt toward where it looks, lift when alert.
  const tilt = gaze.x * 4 + (sleeping ? -6 : 0) + tremble * 0.6;
  const headY = breath * 0.7 + (sleeping ? 2.2 : 0) - p.earUp * 0.6;
  parts.head.setAttribute('transform', `translate(${f(gaze.x * 1.6)} ${f(headY + gaze.y * 0.8)}) rotate(${f(tilt)} 80 76)`);

  // Ears: up/forward is a smaller angle; worried pins them back and down.
  const earAng = -spring.ear * 16 + (still ? 0 : Math.sin(t * 1.3) * 0.6);
  parts.earL.setAttribute('transform', `rotate(${f(earAng)} 54 23)`);
  parts.earR.setAttribute('transform', `rotate(${f(-earAng)} 106 23)`);

  // Brows: tilt (worried lifts the inner ends, guard sets them down) and lift.
  const bt = p.browT * 13;
  const bl = -p.browL * 2.6 - fx.wide * 1.5;
  parts.browL.setAttribute('transform', `translate(0 ${f(bl)}) rotate(${f(bt)} 65.5 33.5)`);
  parts.browR.setAttribute('transform', `translate(0 ${f(bl)}) rotate(${f(-bt)} 94.5 33.5)`);
  parts.wrinkles.setAttribute('opacity', f(0.35 + Math.abs(p.browT) * 0.3 + p.browL * 0.2));

  // Eyes
  const arcAlpha = clamp(Math.max(p.arcA, fx.squint), 0, 1);
  const open = clamp(p.eyes * lid * (1 - arcAlpha), 0.06, 1.2);
  const es = p.eyeS + fx.wide * 0.12;
  const ex = gaze.x * 2.4;
  const ey = gaze.y * 1.8;
  for (const [g, cx] of [[parts.eyeL, 65], [parts.eyeR, 95]]) {
    g.setAttribute('transform', `translate(${f(ex)} ${f(ey)}) translate(${cx} 44) scale(${f(es)} ${f(es * open)}) translate(${-cx} -44)`);
    g.setAttribute('opacity', arcAlpha > 0.98 ? 0 : 1);
  }
  const curve = fx.squint > 0.01 ? 1 : p.arc; // squint is a happy ∩, sleep is a sleepy ∪
  for (const [a, cx] of [[parts.arcL, 65], [parts.arcR, 95]]) {
    a.setAttribute('d', `M${cx - 6} ${f(45 + curve * 1.5)} q6 ${f(-curve * 6)} 12 0`);
    a.setAttribute('opacity', f(arcAlpha));
  }

  // Mouth: a curve from a smile to a frown, opening to show the tongue.
  const pant = still ? 0 : Math.sin(phase.pant) * 0.12 * p.tongue;
  const mo = clamp(p.open + pant + fx.wide * 0.25, 0, 1);
  const sm = p.smile;
  const w = 8 + Math.max(0, p.smile) * 1.6 + mo * 1.2;
  const y0 = 71;
  const cy = y0 + sm * 3.4;
  const ey0 = y0 - sm * 2.2;
  const upper = `M${80 - w} ${f(ey0)} Q${80 - w / 2} ${f(cy)} 80 ${f(y0)} Q${80 + w / 2} ${f(cy)} ${80 + w} ${f(ey0)}`;
  const depth = mo * 11;
  parts.mouth.setAttribute('d', `M80 66 V${f(y0)} ${upper}`);
  if (mo > 0.04) {
    const lower = `Q80 ${f(y0 + depth * 1.7 + sm * 2)} ${80 - w} ${f(ey0)}`;
    parts.mouthFill.setAttribute('d', `${upper} ${lower} Z`);
    const tg = p.tongue * mo;
    parts.tongue.setAttribute('d', tg > 0.05
      ? `M${f(80 - 4.2)} ${f(y0 + 1)} C${f(80 - 4.6)} ${f(y0 + 2 + tg * 12)} ${f(80 + 4.6)} ${f(y0 + 2 + tg * 12)} ${f(80 + 4.2)} ${f(y0 + 1)} Z`
      : '');
  } else {
    parts.mouthFill.setAttribute('d', '');
    parts.tongue.setAttribute('d', '');
  }

  // Tail: wag around its base, tucked down when worried.
  const wagAmp = (p.wag + fx.wagBoost) * 15;
  const wag = still ? 0 : Math.sin(phase.wag) * wagAmp;
  parts.tail.setAttribute('transform', `rotate(${f(wag + p.tuck * 38)} 104 91)`);
  parts.tail.setAttribute('opacity', f(1 - p.tuck * 0.65));

  // Startle mark
  const b = fx.bang;
  parts.bang.setAttribute('opacity', f(clamp(b * 1.6, 0, 1)));
  parts.bang.setAttribute('transform', `translate(124 ${f(30 - hop * 0.6)}) scale(${f(0.6 + Math.min(b, 0.6) * 0.7)}) rotate(12)`);

  // Sleep z's drift up and fade.
  parts.zs.forEach((z, i) => {
    const k = (phase.z + i / 3) % 1;
    const vis = p.zz * (still ? (i === 0 ? 1 : 0) : Math.sin(k * Math.PI));
    z.setAttribute('opacity', f(clamp(vis, 0, 1) * 0.85));
    z.setAttribute('transform', `translate(${f(114 + k * 14 + Math.sin(k * 6) * 2)} ${f(34 - k * 26)}) scale(${f(0.7 + k * 0.6)})`);
  });

  requestAnimationFrame(frame);
}

function react(kind) {
  if (REDUCED.matches) {
    if (kind === 'pet' || kind === 'better') fx.squintUntil = performance.now() + 900;
    if (kind === 'startle') fx.bang = 1;
    return;
  }
  if (kind === 'startle') {
    spring.hopV += 95; spring.squashV -= 3.2; spring.earV += 9;
    fx.bang = 1; fx.wide = 1;
  } else if (kind === 'better') {
    spring.hopV += 55; spring.squashV -= 2;
    fx.wagBoost = 1; fx.squintUntil = performance.now() + 900;
  } else if (kind === 'pet') {
    spring.hopV += 42; spring.squashV -= 1.6; spring.earV -= 4;
    fx.wagBoost = 1.1; fx.squintUntil = performance.now() + 1100;
  }
}

export function mountPug(host) {
  if (!host || parts) return;
  root = host;
  parts = build(host);
  host.title = TITLES.loading;
  host.addEventListener('click', () => react('pet'));
  window.addEventListener('pointermove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.at = performance.now(); }, { passive: true });
  blink.next = performance.now() + 1500;
  requestAnimationFrame(frame);
}

/** Called on every render with the latest score and agent state. Cheap when nothing changed. */
export function setPugMood({ level = 'loading', paused = false, working = false, agents = 0 } = {}) {
  if (!parts) return;
  let next;
  if (level === 'loading') next = 'loading';
  else if (paused) next = 'guard';
  else if (level === 'act') next = 'worried';
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
