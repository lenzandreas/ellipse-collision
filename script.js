(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const easeOutCubic = (t) => 1 - (1 - t) ** 3;
  const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const easeOutBack = (t) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const canvas = $('scene');
  const ctx = canvas.getContext('2d');
  const bg = $('bg');
  const bctx = bg.getContext('2d', { alpha: false });

  const el = {
    titleCard: $('titleCard'),
    controls: $('controls'),
    hint: $('hint'),
    balls: $('statBalls'),
    gen: $('statGen'),
    splits: $('statSplits'),
    pause: $('btnPause'),
    reset: $('btnReset'),
    speed: $('inSpeed'),
    ecc: $('inEcc'),
    max: $('inMax'),
    outSpeed: $('outSpeed'),
    outEcc: $('outEcc'),
    outMax: $('outMax'),
  };

  // ---------------------------------------------------------------------------
  // Settings & geometry (world units: semi-major axis a = 1, centre at origin)
  // ---------------------------------------------------------------------------
  const TRIP_SECONDS = 2.6; // focus -> wall -> focus at 1x speed (path length is always 2a)
  const MAX_PARTICLES = 900;
  const MAX_RIPPLES = 70;
  const AXIS_GAP = (6 * Math.PI) / 180; // directions this close to the major axis are not used
  const TAIL_SECONDS = 0.45;
  const TAIL_PIECES = 10;

  const settings = { speed: 1, ecc: 0.75, maxBalls: 512 };

  let ecc = settings.ecc;
  let semiB = 1;
  let focalC = 0;
  function setEcc(e) {
    ecc = e;
    semiB = Math.sqrt(1 - e * e);
    focalC = e;
  }
  setEcc(settings.ecc);

  const focusX = (fi) => (fi === 0 ? -focalC : focalC);

  // Distance along unit direction (dx, dy) from an interior point to the wall.
  function rayToWall(px, py, dx, dy) {
    const b2 = semiB * semiB;
    const A = dx * dx + (dy * dy) / b2;
    const B = 2 * (px * dx + (py * dy) / b2);
    const C = px * px + (py * py) / b2 - 1;
    return (-B + Math.sqrt(Math.max(0, B * B - 4 * A * C))) / (2 * A);
  }

  // ---------------------------------------------------------------------------
  // Viewport
  // ---------------------------------------------------------------------------
  let W = 0, H = 0;
  let cx = 0, cy = 0, scale = 1;
  let reserveTop = 0, reserveBottom = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    for (const [c, c2d] of [[canvas, ctx], [bg, bctx]]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
      c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    measureChrome();
    paintBackground();
    layout();
  }

  function measureChrome() {
    const narrow = W < 760;
    reserveTop = narrow ? el.titleCard.offsetTop + el.titleCard.offsetHeight + 8 : 24;
    reserveBottom = H - el.controls.offsetTop + 8;
    el.hint.style.bottom = `${reserveBottom + 10}px`;
  }

  function layout() {
    const top = reserveTop;
    const availH = Math.max(140, H - reserveBottom - top);
    const availW = Math.max(140, W - 32);
    scale = Math.min(availW / 2, availH / 2 / semiB) * 0.92;
    cx = W / 2;
    cy = top + availH / 2;
  }

  const sx = (x) => cx + x * scale;
  const sy = (y) => cy + y * scale;

  // Static background on its own canvas, painted only on resize.
  function paintBackground() {
    const g = bctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, Math.hypot(W, H) * 0.65);
    g.addColorStop(0, '#11142c');
    g.addColorStop(0.55, '#070914');
    g.addColorStop(1, '#020308');
    bctx.fillStyle = g;
    bctx.fillRect(0, 0, W, H);

    // Soft nebula blobs
    bctx.globalCompositeOperation = 'lighter';
    const blobs = [
      [W * 0.22, H * 0.3, Math.max(W, H) * 0.45, 'rgba(90, 60, 200, 0.10)'],
      [W * 0.8, H * 0.7, Math.max(W, H) * 0.5, 'rgba(30, 140, 200, 0.08)'],
    ];
    for (const [x, y, r, c] of blobs) {
      const n = bctx.createRadialGradient(x, y, 0, x, y, r);
      n.addColorStop(0, c);
      n.addColorStop(1, 'rgba(0,0,0,0)');
      bctx.fillStyle = n;
      bctx.fillRect(0, 0, W, H);
    }

    // Stars
    const count = Math.round((W * H) / 4500);
    for (let i = 0; i < count; i++) {
      const r = Math.random() ** 3 * 1.2 + 0.25;
      bctx.fillStyle = `hsla(${rand(200, 290)}, 70%, 88%, ${rand(0.08, 0.55)})`;
      bctx.beginPath();
      bctx.arc(Math.random() * W, Math.random() * H, r, 0, TAU);
      bctx.fill();
    }
    bctx.globalCompositeOperation = 'source-over';
  }

  // ---------------------------------------------------------------------------
  // Glow sprites (cached per hue bucket - much cheaper than shadowBlur)
  // ---------------------------------------------------------------------------
  const spriteCache = new Map();
  function sprite(hue) {
    const key = ((Math.round(hue / 6) * 6) % 360 + 360) % 360;
    let s = spriteCache.get(key);
    if (s) return s;
    s = document.createElement('canvas');
    s.width = s.height = 64;
    const g = s.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `hsla(${key}, 100%, 98%, 1)`);
    gr.addColorStop(0.13, `hsla(${key}, 100%, 90%, 1)`);
    gr.addColorStop(0.22, `hsla(${key}, 100%, 68%, 0.85)`);
    gr.addColorStop(0.45, `hsla(${key}, 100%, 58%, 0.22)`);
    gr.addColorStop(1, `hsla(${key}, 100%, 50%, 0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    spriteCache.set(key, s);
    return s;
  }
  function drawSprite(hue, x, y, size, alpha) {
    if (alpha <= 0.003 || size <= 0) return;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(sprite(hue), x - size / 2, y - size / 2, size, size);
  }

  // ---------------------------------------------------------------------------
  // Simulation state
  // ---------------------------------------------------------------------------
  let balls = [];
  let particles = [];
  let ripples = [];
  let waves = [];

  let state = 'intro'; // intro | wait | run | finale | charge
  let stateT = 0;
  let waitDuration = 0.3;
  let time = 0;
  let paused = false;

  let generation = 0;
  let splits = 0;
  let launchFocus = 0;
  let finaleFocus = 0;
  const focusEnergy = [0, 0];
  let flash = 0;
  let flashFocus = 0;

  const genHue = (g) => (195 + g * 37) % 360;

  function setState(s, wait) {
    state = s;
    stateT = 0;
    if (wait !== undefined) waitDuration = wait;
  }

  // Exactly left/right along the major axis is a degenerate path (vertex bounce).
  const nearAxis = (a) => Math.abs(Math.sin(a)) < Math.sin(AXIS_GAP);

  function randomAngle() {
    let a;
    do a = rand(0, TAU); while (nearAxis(a));
    return a;
  }

  function avoidAxis(a) {
    if (!nearAxis(a)) return a;
    const up = Math.sin(a) >= 0 ? 1 : -1;
    const left = Math.cos(a) < 0;
    return left ? Math.PI - up * AXIS_GAP : up * AXIS_GAP;
  }

  // Symmetric fork u ± θ with θ uniform in (0, π): each child direction is
  // uniformly distributed over the full circle.
  function splitSpread(u) {
    for (let i = 0; i < 30; i++) {
      const th = rand(0, Math.PI);
      if (!nearAxis(u + th) && !nearAxis(u - th)) return th;
    }
    return Math.PI / 2;
  }

  // A ball always travels: focus fi -> wall point -> other focus.
  // By the reflection property of the ellipse this is exact, so no numerical drift.
  // The parent's last segment (wall -> focus) is kept so the tail can reach back past the split.
  function makeBall(fi, angle, gen, hue, s0 = 0, parent = null) {
    const fx = focusX(fi);
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const L1 = rayToWall(fx, 0, dx, dy);
    const wx = fx + dx * L1, wy = dy * L1;
    const ex = focusX(1 - fi), ey = 0;
    const L = L1 + Math.hypot(ex - wx, ey - wy);
    const back = parent ? parent.L - parent.L1 : 0;
    const bx = parent ? (parent.wx - parent.ex) / back : 0;
    const by = parent ? (parent.wy - parent.ey) / back : 0;
    hue = ((hue % 360) + 360) % 360;
    return { fi, x0: fx, y0: 0, wx, wy, ex, ey, L1, L, back, bx, by, s: s0, gen, hue, born: time, hitWall: s0 >= L1 };
  }

  // Point at arc length s along the ball's path; negative s runs back along the parent's path.
  function pointAt(b, s) {
    if (s <= 0) {
      const d = Math.min(-s, b.back);
      return [b.x0 + b.bx * d, b.y0 + b.by * d];
    }
    if (s < b.L1) {
      const k = s / b.L1;
      return [b.x0 + (b.wx - b.x0) * k, b.y0 + (b.wy - b.y0) * k];
    }
    const k = Math.min(1, (s - b.L1) / (b.L - b.L1));
    return [b.wx + (b.ex - b.wx) * k, b.wy + (b.ey - b.wy) * k];
  }

  const ballPos = (b) => pointAt(b, b.s);

  function ballRadius(n) {
    return clamp(7 - 0.5 * Math.log2(Math.max(1, n)), 2.6, 7) * clamp(scale / 330, 0.65, 1.35);
  }

  function addParticle(p) {
    if (particles.length < MAX_PARTICLES) particles.push(p);
  }

  function sparks(x, y, n, hue, speedMin, speedMax, life = 0.7, size = 1.6) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), v = rand(speedMin, speedMax);
      addParticle({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: rand(life * 0.5, life), hue: hue + rand(-15, 15), size: rand(size * 0.6, size), drag: 3 });
    }
  }

  function implode(x, y, n, hue) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), d = rand(22, 60), v = rand(90, 180);
      addParticle({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, vx: -Math.cos(a) * v, vy: -Math.sin(a) * v, t: 0, life: d / v, hue, size: rand(1, 1.8), drag: 0 });
    }
  }

  function launch(fi, angle) {
    const b = makeBall(fi, angle, 0, genHue(0));
    balls.push(b);
    focusEnergy[fi] = Math.min(1.6, focusEnergy[fi] + 0.8);
    waves.push({ x: focusX(fi), y: 0, t: 0, life: 0.8, maxR: 46, hue: genHue(0), width: 2 });
    sparks(sx(focusX(fi)), sy(0), 14, genHue(0), 40, 200);
    setState('run');
  }

  function launchInitial() {
    generation = 0;
    splits = 0;
    launch(launchFocus, randomAngle());
  }

  function popAll() {
    for (const b of balls) {
      const [x, y] = ballPos(b);
      sparks(sx(x), sy(y), 4, b.hue, 30, 140, 0.5);
    }
    balls = [];
  }

  function restart(wait = 0.45) {
    popAll();
    ripples = [];
    generation = 0;
    splits = 0;
    launchFocus = 0;
    setState('wait', wait);
  }

  // --- Events -----------------------------------------------------------------
  function onWall(b, count) {
    if (ripples.length < MAX_RIPPLES && Math.random() < Math.min(1, 24 / count)) {
      ripples.push({ x: b.wx, y: b.wy, t: 0, life: 0.9, hue: b.hue });
    }
    if (count <= 32) {
      // Sparks flying back into the ellipse
      const nx = b.wx, ny = b.wy / (semiB * semiB);
      const nl = Math.hypot(nx, ny) || 1;
      for (let i = 0; i < 5; i++) {
        const a = Math.atan2(-ny / nl, -nx / nl) + rand(-1.1, 1.1), v = rand(40, 170);
        addParticle({ x: sx(b.wx), y: sy(b.wy), vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: rand(0.25, 0.55), hue: b.hue, size: rand(0.9, 1.5), drag: 4 });
      }
    }
  }

  function onSplit(fi, hue, count) {
    focusEnergy[fi] = Math.min(1.6, focusEnergy[fi] + 0.45);
    const n = Math.max(1, Math.round(10 - 1.2 * Math.log2(count)));
    sparks(sx(focusX(fi)), sy(0), n, hue, 50, 240);
    if (waves.length < 8) waves.push({ x: focusX(fi), y: 0, t: 0, life: 0.7, maxR: 38 + Math.min(40, count / 6), hue, width: 1.8 });
  }

  function onAbsorb(fi, hue) {
    focusEnergy[fi] = Math.min(1.6, focusEnergy[fi] + 0.3);
    implode(sx(focusX(fi)), sy(0), 2, hue);
  }

  function startFinale(fi) {
    finaleFocus = fi;
    setState('finale');
  }

  function supernova() {
    const fi = finaleFocus;
    const x = sx(focusX(fi)), y = sy(0);
    flash = reducedMotion ? 0.2 : 0.55;
    flashFocus = fi;
    focusEnergy[fi] = 2.2;
    const big = Math.max(W, H);
    waves.push({ x: focusX(fi), y: 0, t: 0, life: 1.6, maxR: big * 0.9, hue: 200, width: 6 });
    waves.push({ x: focusX(fi), y: 0, t: -0.12, life: 1.5, maxR: big * 0.6, hue: 280, width: 4 });
    waves.push({ x: focusX(fi), y: 0, t: -0.25, life: 1.3, maxR: big * 0.35, hue: 170, width: 3 });
    for (let i = 0; i < 220; i++) {
      const a = rand(0, TAU), v = rand(80, 720);
      addParticle({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: rand(0.8, 1.9), hue: rand(0, 360), size: rand(1.4, 3.2), drag: 1.7 });
    }
    launchFocus = fi;
    setState('wait', 1.5);
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  const speedWorld = () => (settings.speed * 2) / TRIP_SECONDS;

  function update(dt) {
    time += dt;
    stateT += dt;

    // Smooth eccentricity morph
    if (ecc !== settings.ecc) {
      const next = ecc + (settings.ecc - ecc) * (1 - Math.exp(-dt * 9));
      setEcc(Math.abs(settings.ecc - next) < 5e-4 ? settings.ecc : next);
      if (state === 'wait') stateT = 0;
    }
    layout();

    // State machine
    if (state === 'intro' && stateT > 1.7) {
      setState('wait', 0.2);
      showHint();
    } else if (state === 'wait' && stateT > waitDuration && ecc === settings.ecc) {
      launchInitial();
    } else if (state === 'charge') {
      const x = sx(focusX(finaleFocus)), y = sy(0);
      focusEnergy[finaleFocus] = Math.max(focusEnergy[finaleFocus], 0.6 + stateT * 1.6);
      if (Math.random() < 0.9) implode(x, y, 3, rand(0, 360));
      if (stateT > 0.85) supernova();
    }

    // Balls
    let count = balls.length;
    const ds = speedWorld() * dt;
    const next = [];
    for (const b of balls) {
      b.s += ds;
      if (!b.hitWall && b.s >= b.L1) {
        b.hitWall = true;
        onWall(b, count);
      }
      if (b.s < b.L) {
        next.push(b);
        continue;
      }

      // Reached the other focus
      const fi = 1 - b.fi;
      if (state === 'run' && count + 1 <= settings.maxBalls) {
        const inAngle = Math.atan2(b.ey - b.wy, b.ex - b.wx);
        const spread = splitSpread(inAngle);
        const g = b.gen + 1;
        const hue = genHue(g);
        const over = b.s - b.L;
        for (const sgn of [-1, 1]) {
          next.push(makeBall(fi, inAngle + sgn * spread, g, hue + sgn * 7, over, b));
        }
        count += 1;
        splits += 1;
        generation = Math.max(generation, g);
        onSplit(fi, hue, count);
      } else {
        if (state === 'run') startFinale(fi);
        count -= 1;
        onAbsorb(fi, b.hue);
      }
    }
    balls = next;

    if (state === 'finale' && balls.length === 0) setState('charge');

    // Effects
    for (let i = 0; i < 2; i++) focusEnergy[i] *= Math.exp(-dt * 2.6);
    flash *= Math.exp(-dt * 3.5);

    for (const p of particles) {
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy *= d;
    }
    particles = particles.filter((p) => p.t < p.life);
    for (const rp of ripples) rp.t += dt;
    ripples = ripples.filter((rp) => rp.t < rp.life);
    for (const w of waves) w.t += dt;
    waves = waves.filter((w) => w.t < w.life);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function introProgress() {
    return state === 'intro' ? easeInOutCubic(clamp(stateT / 1.3, 0, 1)) : 1;
  }
  function fociProgress() {
    return state === 'intro' ? easeOutBack(clamp((stateT - 0.7) / 0.6, 0, 1)) : 1;
  }

  function ellipsePath(start, sweep) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, scale, semiB * scale, 0, start, start + sweep);
  }

  function drawEllipseBody(k) {
    ctx.globalAlpha = k;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, scale);
    g.addColorStop(0, 'rgba(45, 55, 125, 0.24)');
    g.addColorStop(1, 'rgba(20, 24, 60, 0.06)');
    ctx.fillStyle = g;
    ellipsePath(0, TAU);
    ctx.fill();

    // Faint major axis
    ctx.setLineDash([4, 7]);
    ctx.strokeStyle = 'rgba(150, 170, 255, 0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - scale, cy);
    ctx.lineTo(cx + scale, cy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // Tails are recomputed from each ball's path every frame, so nothing is left behind.
  // Each tail is cut into pieces that get fainter and thinner towards its end; pieces
  // with the same hue and index are stroked together as one path.
  const tailBatches = new Map();
  function drawTails() {
    if (!balls.length) return;
    const step = Math.min(0.7, speedWorld() * TAIL_SECONDS) / TAIL_PIECES;
    for (const b of balls) {
      for (let k = 0; k < TAIL_PIECES; k++) {
        const sb = b.s - (TAIL_PIECES - 1 - k) * step;
        const sa = Math.max(sb - step, -b.back);
        if (sb <= sa) continue;
        const pts = [pointAt(b, sa)];
        if (sa < 0 && sb > 0) pts.push([b.x0, b.y0]);
        if (sa < b.L1 && sb > b.L1) pts.push([b.wx, b.wy]);
        pts.push(pointAt(b, sb));
        const key = (b.hue | 0) * TAIL_PIECES + k;
        let list = tailBatches.get(key);
        if (!list) tailBatches.set(key, (list = []));
        list.push(pts);
      }
    }

    const count = balls.length;
    const alpha = clamp(0.9 * (16 / count) ** 0.35, 0.25, 0.9);
    const width = ballRadius(count) * 0.85;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'butt'; // round caps overlap additively and look beaded
    ctx.lineJoin = 'round';
    for (const [key, list] of tailBatches) {
      const k = key % TAIL_PIECES;
      const f = (k + 1) / TAIL_PIECES;
      ctx.globalAlpha = alpha * f ** 1.6;
      ctx.lineWidth = width * (0.35 + 0.65 * f);
      ctx.strokeStyle = `hsl(${(key - k) / TAIL_PIECES}, 100%, 62%)`;
      ctx.beginPath();
      for (const pts of list) {
        ctx.moveTo(sx(pts[0][0]), sy(pts[0][1]));
        for (let i = 1; i < pts.length; i++) ctx.lineTo(sx(pts[i][0]), sy(pts[i][1]));
      }
      ctx.stroke();
    }
    tailBatches.clear();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawRipples() {
    if (!ripples.length) return;
    const sz = clamp(scale / 330, 0.65, 1.35);
    ctx.save();
    ellipsePath(0, TAU);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    for (const rp of ripples) {
      const k = rp.t / rp.life;
      const x = sx(rp.x), y = sy(rp.y);
      for (const [delay, amp] of [[0, 1], [0.18, 0.55]]) {
        const kk = (rp.t - delay) / (rp.life - delay);
        if (kk <= 0) continue;
        ctx.strokeStyle = `hsla(${rp.hue | 0}, 100%, 72%, ${(1 - kk) ** 1.6 * 0.75 * amp})`;
        ctx.lineWidth = 1.6 * (1 - kk) + 0.4;
        ctx.beginPath();
        ctx.arc(x, y, 3 + easeOutCubic(kk) * 36 * sz, 0, TAU);
        ctx.stroke();
      }
      if (k < 0.4) drawSprite(rp.hue, x, y, 40 * sz, (1 - k / 0.4) * 0.6);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawEllipseWall(k) {
    const h1 = 190 + 15 * Math.sin(time * 0.35);
    const h2 = 275 + 20 * Math.sin(time * 0.27 + 1);
    const g = ctx.createLinearGradient(cx - scale, cy - semiB * scale, cx + scale, cy + semiB * scale);
    g.addColorStop(0, `hsl(${h1}, 100%, 66%)`);
    g.addColorStop(0.5, `hsl(${h2}, 100%, 70%)`);
    g.addColorStop(1, `hsl(${h1}, 100%, 66%)`);
    ctx.strokeStyle = g;
    ctx.globalCompositeOperation = 'lighter';
    const start = Math.PI;
    const sweep = TAU * k;
    for (const [w, a] of [[18, 0.04], [8, 0.1], [3.2, 0.3], [1.3, 1]]) {
      ctx.globalAlpha = a;
      ctx.lineWidth = w;
      ellipsePath(start, sweep);
      ctx.stroke();
    }
    if (k < 1) {
      const a = start + sweep;
      drawSprite(h1, cx + Math.cos(a) * scale, cy + Math.sin(a) * semiB * scale, 54, 1);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawFoci() {
    const pop = fociProgress();
    if (pop <= 0) return;
    const overlap = focalC * scale < 18;
    for (let fi = 0; fi < 2; fi++) {
      if (overlap && fi === 1) break;
      const x = sx(focusX(fi)), y = sy(0);
      const e = focusEnergy[fi];
      const hover = hoverFocus === fi || (aim && aim.fi === fi);
      const pulse = 0.5 + 0.5 * Math.sin(time * 2.2 + fi * Math.PI);

      ctx.globalCompositeOperation = 'lighter';
      drawSprite(200, x, y, (34 + e * 70 + pulse * 6 + (hover ? 14 : 0)) * pop, 0.45 + 0.4 * Math.min(1, e));
      if (e > 0.8) drawSprite(0, x, y, 30 * e, (e - 0.8) * 0.5);
      ctx.globalCompositeOperation = 'source-over';

      // Core
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x, y, 3 * pop, 0, TAU);
      ctx.fill();

      // Rings
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = `rgba(190, 215, 255, ${hover ? 0.95 : 0.6})`;
      ctx.beginPath();
      ctx.arc(x, y, (9 + (hover ? 3 : 0)) * pop, 0, TAU);
      ctx.stroke();

      ctx.setLineDash([3, 5]);
      ctx.lineDashOffset = (fi === 0 ? -1 : 1) * time * 14;
      ctx.strokeStyle = `rgba(160, 190, 255, ${0.35 + Math.min(0.5, e * 0.4)})`;
      ctx.beginPath();
      ctx.arc(x, y, (16 + e * 7 + (hover ? 4 : 0)) * pop, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);

      // Charging ring before the supernova
      if (state === 'charge' && fi === finaleFocus) {
        const k = clamp(stateT / 0.85, 0, 1);
        ctx.strokeStyle = `rgba(230, 240, 255, ${k})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 90 * (1 - k) ** 2 + 10, 0, TAU);
        ctx.stroke();
      }

      // Label
      ctx.globalAlpha = clamp(pop, 0, 1);
      ctx.font = '600 11px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = hover ? 'rgba(220, 235, 255, 0.95)' : 'rgba(190, 200, 240, 0.55)';
      const label = overlap ? 'F₁ = F₂' : fi === 0 ? 'F₁' : 'F₂';
      ctx.fillText(label, x, y + 34);
      if (hover && !aim) {
        ctx.font = '500 10px Inter, system-ui, sans-serif';
        ctx.fillStyle = 'rgba(94, 231, 255, 0.85)';
        ctx.fillText('drag to launch', x, y + 48);
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawBalls() {
    const r = ballRadius(balls.length);
    for (const b of balls) {
      const [x, y] = ballPos(b);
      const age = time - b.born;
      const grow = age < 0.25 ? easeOutBack(age / 0.25) : 1;
      drawSprite(b.hue, sx(x), sy(y), r * 6.2 * grow, 1);
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const k = p.t / p.life;
      drawSprite(p.hue, p.x, p.y, p.size * 6 * (1 - k * 0.5), (1 - k) ** 1.2);
    }
  }

  function drawWaves() {
    ctx.globalAlpha = 1;
    for (const w of waves) {
      if (w.t < 0) continue;
      const k = w.t / w.life;
      ctx.strokeStyle = `hsla(${w.hue}, 100%, 75%, ${(1 - k) ** 2 * 0.8})`;
      ctx.lineWidth = w.width * (1 - k) + 0.5;
      ctx.beginPath();
      ctx.arc(sx(w.x), sy(w.y), easeOutCubic(k) * w.maxR, 0, TAU);
      ctx.stroke();
    }
  }

  function drawAim() {
    if (!aim) return;
    const fx = sx(focusX(aim.fi)), fy = sy(0);
    const dx = aim.x - fx, dy = aim.y - fy;
    const len = Math.hypot(dx, dy);
    if (len < 10) return;
    const ux = dx / len, uy = dy / len;
    const t = rayToWall(focusX(aim.fi), 0, ux, uy);
    const wx = fx + ux * t * scale, wy = fy + uy * t * scale;
    const ox = sx(focusX(1 - aim.fi)), oy = sy(0);

    ctx.lineWidth = 1.6;
    ctx.setLineDash([6, 6]);
    ctx.lineDashOffset = -time * 40;
    ctx.strokeStyle = 'rgba(94, 231, 255, 0.9)';
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(wx, wy);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(176, 107, 255, 0.45)';
    ctx.beginPath();
    ctx.moveTo(wx, wy);
    ctx.lineTo(ox, oy);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.globalCompositeOperation = 'lighter';
    drawSprite(190, wx, wy, 30, 0.9);
    ctx.globalCompositeOperation = 'source-over';

    // Arrow head near the focus
    const ax = fx + ux * 34, ay = fy + uy * 34;
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(94, 231, 255, 0.95)';
    ctx.beginPath();
    ctx.moveTo(ax + ux * 8, ay + uy * 8);
    ctx.lineTo(ax - uy * 5, ay + ux * 5);
    ctx.lineTo(ax + uy * 5, ay - ux * 5);
    ctx.closePath();
    ctx.fill();

    const deg = Math.round(((-Math.atan2(uy, ux) * 180) / Math.PI + 360) % 360);
    ctx.font = '500 11px "JetBrains Mono", Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(220, 235, 255, 0.85)';
    ctx.fillText(`${deg}°`, aim.x + 12, aim.y - 10);
  }

  function drawFlash() {
    if (flash < 0.01) return;
    const x = sx(focusX(flashFocus)), y = sy(0);
    const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(W, H));
    g.addColorStop(0, `rgba(225, 238, 255, ${flash})`);
    g.addColorStop(0.3, `rgba(140, 120, 255, ${flash * 0.25})`);
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }

  function render() {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);

    const k = introProgress();
    drawEllipseBody(k);
    drawRipples();
    drawTails();

    drawEllipseWall(k);
    drawFoci();

    ctx.globalCompositeOperation = 'lighter';
    drawBalls();
    drawParticles();
    drawWaves();
    ctx.globalCompositeOperation = 'source-over';

    drawAim();
    drawFlash();
  }

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------
  const shown = { balls: -1, gen: -1, splits: -1 };
  function updateStats() {
    if (shown.balls !== balls.length) el.balls.textContent = shown.balls = balls.length;
    if (shown.splits !== splits) el.splits.textContent = shown.splits = splits;
    if (shown.gen !== generation) {
      el.gen.textContent = shown.gen = generation;
      el.gen.classList.remove('bump');
      void el.gen.offsetWidth; // restart the animation
      el.gen.classList.add('bump');
    }
  }

  let hintTimer = 0;
  function showHint() {
    el.hint.classList.add('show');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(hideHint, 9000);
  }
  function hideHint() {
    el.hint.classList.remove('show');
  }

  // ---------------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------------
  function fillRange(input) {
    const p = ((input.value - input.min) / (input.max - input.min)) * 100;
    input.style.setProperty('--p', `${p}%`);
  }

  function setPaused(p) {
    paused = p;
    el.pause.classList.toggle('paused', p);
    el.pause.setAttribute('aria-label', p ? 'Play' : 'Pause');
    el.pause.title = p ? 'Play (Space)' : 'Pause (Space)';
  }

  el.speed.addEventListener('input', () => {
    settings.speed = 2 ** Number(el.speed.value);
    el.outSpeed.textContent = `${settings.speed.toFixed(2)}×`;
    fillRange(el.speed);
  });

  el.ecc.addEventListener('input', () => {
    settings.ecc = Number(el.ecc.value);
    el.outEcc.textContent = settings.ecc.toFixed(2);
    fillRange(el.ecc);
    if (state !== 'intro') restart(0.4);
  });

  el.max.addEventListener('input', () => {
    settings.maxBalls = 2 ** Number(el.max.value);
    el.outMax.textContent = settings.maxBalls;
    fillRange(el.max);
  });

  el.pause.addEventListener('click', () => setPaused(!paused));
  el.reset.addEventListener('click', () => {
    if (state !== 'intro') restart();
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      setPaused(!paused);
    } else if (e.key === 'r' || e.key === 'R') {
      if (state !== 'intro') restart();
    }
  });

  // ---------------------------------------------------------------------------
  // Pointer: drag from a focus to aim & launch
  // ---------------------------------------------------------------------------
  let aim = null;
  let hoverFocus = -1;

  function focusAt(x, y, radius) {
    if (state === 'intro') return -1;
    let best = -1, bestD = radius;
    for (let fi = 0; fi < 2; fi++) {
      const d = Math.hypot(x - sx(focusX(fi)), y - sy(0));
      if (d < bestD) { best = fi; bestD = d; }
    }
    return best;
  }

  const canLaunch = () => (state === 'run' || state === 'wait') && balls.length < settings.maxBalls;

  canvas.addEventListener('pointerdown', (e) => {
    const fi = focusAt(e.clientX, e.clientY, e.pointerType === 'touch' ? 38 : 26);
    if (fi < 0) return;
    aim = { fi, x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('aiming');
    hideHint();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (aim) {
      aim.x = e.clientX;
      aim.y = e.clientY;
      return;
    }
    hoverFocus = e.pointerType === 'mouse' ? focusAt(e.clientX, e.clientY, 26) : -1;
    canvas.classList.toggle('can-grab', hoverFocus >= 0);
  });

  canvas.addEventListener('pointerup', () => {
    if (!aim) return;
    const dx = aim.x - sx(focusX(aim.fi)), dy = aim.y - sy(0);
    const angle = Math.hypot(dx, dy) > 10 ? avoidAxis(Math.atan2(dy, dx)) : randomAngle();
    if (canLaunch()) {
      if (state === 'wait') {
        generation = 0;
        splits = 0;
      }
      launch(aim.fi, angle);
    }
    aim = null;
    canvas.classList.remove('aiming');
  });

  canvas.addEventListener('pointercancel', () => {
    aim = null;
    canvas.classList.remove('aiming');
  });

  canvas.addEventListener('pointerleave', () => {
    if (!aim) {
      hoverFocus = -1;
      canvas.classList.remove('can-grab');
    }
  });

  // ---------------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (paused) layout();
    else update(dt);
    render();
    updateStats();
    requestAnimationFrame(frame);
  }

  [el.speed, el.ecc, el.max].forEach(fillRange);
  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });
})();
