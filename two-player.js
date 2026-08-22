(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const frame = $('frame');
  const menu = $('menu');
  const startBtn = $('startBtn');
  const pauseBtn = $('pauseBtn');
  const resetBtn = $('resetBtn');
  const feedbackEl = $('feedback');
  const feedbackTitle = $('feedbackTitle');
  const feedbackSub = $('feedbackSub');
  const matchPoint = $('matchPoint');
  const rallyEl = $('rally');
  const statusLine = $('statusLine');
  const modeHelp = $('modeHelp');
  const modeButtons = [...document.querySelectorAll('[data-mode]')];

  const WORLD = { w: 1600, h: 900 };
  const FIELD_RADIUS = { attract: 475, repel: 350 };
  const PULSE_COOLDOWN = { attract: 1.30, repel: 1.72 };
  const PULSE_DURATION = .20;
  const DASH_COOLDOWN = 1.75;
  const DASH_DURATION = .12;
  const CAPTURE_MAX = .82;
  const HEAT_LOCK = .96;
  const keys = new Set();
  const pointers = new Map();
  const lastTap = { left: 0, right: 0 };

  const MODES = {
    duel: { left: 'repel', right: 'repel', help: 'DUEL: due Repulsor. Difesa immediata, Heat e Perfect Parry.' },
    orbit: { left: 'attract', right: 'attract', help: 'ORBIT: due Attractor. Cattura, aspetta la finestra dorata e usa Perfect Slingshot.' },
    polarity: { left: 'attract', right: 'repel', help: 'POLARITY: ruoli opposti e scambio dopo ogni punto. Primo a 5.' }
  };

  const makeEmitter = (x, side) => ({
    x, y: WORLD.h / 2, r: 42, side, type: 'repel', fieldR: FIELD_RADIUS.repel, maxSpeed: 720,
    pulse: 0, cooldown: 0, captureTime: 0, orbitAngle: 0, orbitSpin: 1,
    heat: 0, overheated: false, dashCooldown: 0, dashTime: 0, dashX: 0, dashY: 0
  });

  const state = {
    score: { left: 0, right: 0 },
    left: makeEmitter(WORLD.w * .16, 'left'),
    right: makeEmitter(WORLD.w * .84, 'right'),
    ball: { x: WORLD.w / 2, y: WORLD.h / 2, vx: 0, vy: 0, r: 14, trail: [], capturedBy: null, chargedBy: null, chargedTime: 0 },
    particles: [], rally: 0, lastOwner: null, rallyTimer: 0, wallTimer: 0
  };

  let selectedMode = 'duel';
  let polarityLeftType = 'attract';
  let running = false, paused = false, resetTimer = 0, lastTime = performance.now(), accumulator = 0;
  let feedbackTimer = 0, shake = 0, hitStop = 0, audioCtx = null;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth01 = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const fadeOut = (t, start = .72) => 1 - smooth01((t - start) / (1 - start));
  const opposite = t => t === 'attract' ? 'repel' : 'attract';
  const speedOf = b => Math.hypot(b.vx, b.vy);
  const ownerDir = side => side === 'left' ? 1 : -1;
  const targetScore = () => selectedMode === 'polarity' ? 5 : 7;
  const emitterFor = side => side === 'left' ? state.left : state.right;

  function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }
  function tone(freq, duration = .07, gain = .025, type = 'sine', glide = 1) {
    if (!audioCtx) return;
    const t = audioCtx.currentTime, o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * glide), t + duration);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(.0001, t + duration);
    o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + duration);
  }
  function sfx(kind) {
    if (kind === 'pulse') { tone(150, .14, .04, 'sawtooth', 2.5); tone(430, .10, .02, 'sine', 1.5); }
    if (kind === 'perfect') { tone(250, .09, .04, 'triangle', 2.7); tone(820, .15, .023, 'sine', 1.4); }
    if (kind === 'point') { tone(430, .12, .04, 'triangle', 1.55); tone(710, .17, .025, 'sine', 1.3); }
    if (kind === 'dash') tone(120, .08, .024, 'sawtooth', 2.1);
    if (kind === 'wall') tone(220, .04, .014, 'square', .9);
  }

  function resize() {
    const r = frame.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(canvas.width / WORLD.w, 0, 0, canvas.height / WORLD.h, 0, 0);
  }
  function worldFromClient(x, y) {
    const r = canvas.getBoundingClientRect();
    return { x: (x - r.left) / r.width * WORLD.w, y: (y - r.top) / r.height * WORLD.h };
  }

  function setType(e, type) {
    e.type = type; e.fieldR = FIELD_RADIUS[type]; e.heat = 0; e.overheated = false; e.captureTime = 0;
  }
  function applyMode(announce = false) {
    if (selectedMode === 'polarity') {
      setType(state.left, polarityLeftType); setType(state.right, opposite(polarityLeftType));
    } else {
      setType(state.left, MODES[selectedMode].left); setType(state.right, MODES[selectedMode].right);
    }
    modeButtons.forEach(b => b.classList.toggle('active', b.dataset.mode === selectedMode));
    modeHelp.textContent = MODES[selectedMode].help;
    startBtn.textContent = `PLAY — PRIMO A ${targetScore()}`;
    if (announce) feedback('POLI INVERTITI', `P1 ${state.left.type === 'attract' ? 'ATTRACTOR' : 'REPULSOR'} · P2 ${state.right.type === 'attract' ? 'ATTRACTOR' : 'REPULSOR'}`, 850);
    updateHud();
  }

  function resetPositions(serveDir = 0) {
    state.left.x = WORLD.w * .16; state.left.y = WORLD.h / 2;
    state.right.x = WORLD.w * .84; state.right.y = WORLD.h / 2;
    for (const e of [state.left, state.right]) { e.pulse = 0; e.heat = 0; e.overheated = false; e.captureTime = 0; e.dashTime = 0; e.cooldown = Math.min(e.cooldown, .35); }
    const b = state.ball;
    b.capturedBy = null; b.chargedBy = null; b.chargedTime = 0; b.trail.length = 0;
    b.x = WORLD.w / 2; b.y = WORLD.h / 2 + (Math.random() - .5) * 150;
    const a = (Math.random() - .5) * .52, dir = serveDir || (Math.random() < .5 ? -1 : 1), sp = 500;
    b.vx = Math.cos(a) * sp * dir; b.vy = Math.sin(a) * sp;
    state.rally = 0; state.lastOwner = null; state.rallyTimer = 0; resetTimer = .54;
  }

  function newMatch() {
    initAudio(); state.score.left = state.score.right = 0; paused = false; pauseBtn.textContent = 'Ⅱ PAUSA';
    polarityLeftType = 'attract'; applyMode(false);
    for (const e of [state.left, state.right]) { e.cooldown = 0; e.dashCooldown = 0; }
    resetPositions(); running = true; menu.style.display = 'none'; lastTime = performance.now(); accumulator = 0;
    feedback('READY', selectedMode === 'polarity' ? 'I RUOLI CAMBIANO DOPO OGNI PUNTO' : 'FIRST TO WIN', 800);
  }

  function endMatch(side) {
    running = false; updateHud(); menu.style.display = 'grid';
    menu.querySelector('h2').textContent = `${side === 'left' ? 'P1' : 'P2'} vince!`;
    modeHelp.textContent = `Finale ${state.score.left} — ${state.score.right}. Rivincita?`;
    startBtn.textContent = 'RIVINCITA';
  }

  function scorePoint(side) {
    state.score[side]++; shake = 15; hitStop = .045; sfx('point');
    feedback(`PUNTO ${side === 'left' ? 'P1' : 'P2'}!`, state.rally >= 3 ? `RALLY ×${state.rally}` : 'NICE SHOT', 760);
    updateHud();
    if (state.score[side] >= targetScore()) { setTimeout(() => endMatch(side), 380); return; }
    if (selectedMode === 'polarity') { polarityLeftType = opposite(polarityLeftType); applyMode(true); }
    resetPositions(side === 'left' ? 1 : -1);
  }

  function feedback(title, sub = '', ms = 600) {
    feedbackTitle.textContent = title; feedbackSub.textContent = sub; feedbackEl.classList.add('show'); feedbackTimer = ms / 1000;
  }

  function pointerFor(side) {
    for (const p of pointers.values()) if (p.side === side) return p;
    return null;
  }
  function keyboardVector(side) {
    let dx = 0, dy = 0;
    if (side === 'left') {
      if (keys.has('KeyA')) dx--; if (keys.has('KeyD')) dx++; if (keys.has('KeyW')) dy--; if (keys.has('KeyS')) dy++;
    } else {
      if (keys.has('ArrowLeft')) dx--; if (keys.has('ArrowRight')) dx++; if (keys.has('ArrowUp')) dy--; if (keys.has('ArrowDown')) dy++;
    }
    const m = Math.hypot(dx, dy); return m ? { x: dx / m, y: dy / m } : null;
  }
  function moveToward(e, tx, ty, speed, dt) {
    const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy); if (d < 1) return;
    const s = Math.min(d, speed * dt); e.x += dx / d * s; e.y += dy / d * s;
  }
  function updateHuman(e, dt) {
    if (e.dashTime > 0) { e.x += e.dashX * 1700 * dt; e.y += e.dashY * 1700 * dt; return; }
    const p = pointerFor(e.side), kv = keyboardVector(e.side);
    if (p) moveToward(e, p.x, p.y, e.maxSpeed, dt);
    else if (kv) { e.x += kv.x * e.maxSpeed * dt; e.y += kv.y * e.maxSpeed * dt; }
  }
  function enforceZones() {
    state.left.x = clamp(state.left.x, state.left.r, WORLD.w * 2 / 3 - state.left.r);
    state.right.x = clamp(state.right.x, WORLD.w / 3 + state.right.r, WORLD.w - state.right.r);
    for (const e of [state.left, state.right]) e.y = clamp(e.y, e.r, WORLD.h - e.r);
  }

  function activateDash(e) {
    if (!running || paused || e.dashCooldown > 0) return;
    let v = keyboardVector(e.side); const p = pointerFor(e.side);
    if (!v && p) { const m = Math.hypot(p.x - e.x, p.y - e.y) || 1; v = { x: (p.x - e.x) / m, y: (p.y - e.y) / m }; }
    if (!v) { const b = state.ball, m = Math.hypot(b.x - e.x, b.y - e.y) || 1; v = { x: (b.x - e.x) / m, y: (b.y - e.y) / m }; }
    e.dashX = v.x; e.dashY = v.y; e.dashTime = DASH_DURATION; e.dashCooldown = DASH_COOLDOWN;
    burst(e.x, e.y, e.side, 12, 180); sfx('dash');
  }

  function perfectSlingWindow(e) {
    if (state.ball.capturedBy !== e) return false;
    const tangentX = -Math.sin(e.orbitAngle) * e.orbitSpin;
    const tangentY = Math.cos(e.orbitAngle) * e.orbitSpin;
    const dir = ownerDir(e.side);
    return tangentX * dir > .82 && Math.abs(tangentY) < .56;
  }

  function tryNearestCapture() {
    const b = state.ball;
    if (b.capturedBy) return false;
    const candidates = [state.left, state.right]
      .filter(e => e.type === 'attract')
      .map(e => ({ e, d: Math.hypot(b.x - e.x, b.y - e.y) }))
      .filter(x => x.d <= x.e.fieldR * .58)
      .sort((a, b2) => a.d - b2.d);
    return candidates.length ? enterCapture(candidates[0].e) : false;
  }

  function enterCapture(e) {
    const b = state.ball; if (b.capturedBy || e.type !== 'attract') return false;
    const dx = b.x - e.x, dy = b.y - e.y, d = Math.hypot(dx, dy); if (d > e.fieldR * .58) return false;
    b.capturedBy = e; e.captureTime = 0; e.orbitAngle = Math.atan2(dy, dx);
    const cross = b.vx * dy - b.vy * dx; e.orbitSpin = Math.sign(cross || (e.side === 'left' ? 1 : -1));
    b.vx = b.vy = 0; registerRally(e.side); burst(b.x, b.y, e.side, 10, 130);
    feedback(`CATCH ${e.side === 'left' ? 'P1' : 'P2'}`, 'ASPETTA LA FINESTRA DORATA', 430); return true;
  }

  function releaseCapture(e, forced = false) {
    const b = state.ball; if (b.capturedBy !== e) return false;
    const perfect = perfectSlingWindow(e) && !forced, dir = ownerDir(e.side), spin = e.orbitSpin;
    let tx = -Math.sin(e.orbitAngle) * spin, ty = Math.cos(e.orbitAngle) * spin;
    if (tx * dir < .25) tx = dir * .55;
    const m = Math.hypot(tx, ty) || 1; tx /= m; ty /= m;
    const charge = clamp(e.captureTime / CAPTURE_MAX, 0, 1), speed = perfect ? 1580 : forced ? 1050 : 1210 + 210 * charge;
    b.vx = tx * speed; b.vy = ty * speed;
    if (b.vx * dir < speed * .55) { b.vx = dir * speed * .55; b.vy = Math.sign(b.vy || 1) * Math.sqrt(Math.max(1, speed * speed - b.vx * b.vx)); }
    b.capturedBy = null; e.captureTime = 0; b.chargedBy = e.side; b.chargedTime = perfect ? 1.35 : .85; registerRally(e.side);
    feedback(perfect ? 'SUPERCHARGE!' : forced ? 'AUTO RELEASE' : 'SLINGSHOT', `${e.side === 'left' ? 'P1' : 'P2'} · ${Math.round(speed)} SPEED`, perfect ? 760 : 520);
    if (perfect) { sfx('perfect'); shake = 11; hitStop = .025; }
    burst(b.x, b.y, perfect ? 'gold' : e.side, perfect ? 24 : 15, perfect ? 300 : 220); return true;
  }

  function repulsorParry(e) {
    const b = state.ball, dx = b.x - e.x, dy = b.y - e.y, d = Math.hypot(dx, dy); if (d > e.fieldR * .72) return false;
    const dir = ownerDir(e.side), incoming = e.side === 'left' ? b.vx < -60 : b.vx > 60;
    const perfect = d < e.fieldR * .36 && incoming && !e.overheated, speed = perfect ? 1480 : 930;
    const side = clamp(dy / (e.fieldR * .55), -1, 1), vy = clamp(b.vy * .30 + side * (perfect ? 330 : 210), -speed * .62, speed * .62);
    b.vx = dir * Math.sqrt(Math.max(1, speed * speed - vy * vy)); b.vy = vy;
    e.heat = clamp(e.heat + (perfect ? .28 : .42), 0, 1); if (e.heat >= HEAT_LOCK) e.overheated = true;
    if (perfect) { b.chargedBy = e.side; b.chargedTime = 1.15; }
    registerRally(e.side); feedback(perfect ? 'PERFECT PARRY!' : 'PARRY', `${e.side === 'left' ? 'P1' : 'P2'} · HEAT ${Math.round(e.heat * 100)}%`, perfect ? 680 : 420);
    if (perfect) { sfx('perfect'); shake = 9; hitStop = .02; }
    burst(b.x, b.y, perfect ? 'gold' : e.side, perfect ? 20 : 11, perfect ? 280 : 185); return true;
  }

  function activatePulse(e) {
    if (!running || paused || e.cooldown > 0) return;
    if (e.type === 'repel' && e.overheated) { feedback(`${e.side === 'left' ? 'P1' : 'P2'} OVERHEAT`, 'RAFFREDDA', 380); return; }
    initAudio(); e.pulse = PULSE_DURATION; e.cooldown = PULSE_COOLDOWN[e.type];
    const action = e.type === 'attract' ? releaseCapture(e, false) : repulsorParry(e);
    if (!action && e.type === 'repel') e.heat = clamp(e.heat + .18, 0, 1);
    if (!action) feedback(`${e.side === 'left' ? 'P1' : 'P2'} PULSE`, e.type === 'attract' ? 'PRIMA CATTURA' : 'TROPPO PRESTO', 330);
    sfx('pulse'); burst(e.x, e.y, e.side, 14, 200);
  }

  function dangerBoost(e) {
    const forward = e.side === 'left' ? clamp((e.x - WORLD.w * .22) / (WORLD.w * .45), 0, 1) : clamp((WORLD.w * .78 - e.x) / (WORLD.w * .45), 0, 1);
    return 1 + .20 * smooth01(forward);
  }
  function wallWeights(e) {
    const r = e.fieldR; return { left: clamp(1 - e.x / r, 0, 1), right: clamp(1 - (WORLD.w - e.x) / r, 0, 1), top: clamp(1 - e.y / r, 0, 1), bottom: clamp(1 - (WORLD.h - e.y) / r, 0, 1) };
  }
  function bendAtWalls(e, b, fx, fy, w) {
    const original = Math.hypot(fx, fy); if (!original) return { fx: 0, fy: 0 }; const bend = .78;
    if (w.left && fx < 0) { const lost = -fx * w.left * bend; fx *= 1 - w.left * .66; fy += Math.sign(b.y - e.y || fy || 1) * lost; }
    if (w.right && fx > 0) { const lost = fx * w.right * bend; fx *= 1 - w.right * .66; fy += Math.sign(b.y - e.y || fy || 1) * lost; }
    if (w.top && fy < 0) { const lost = -fy * w.top * bend; fy *= 1 - w.top * .66; fx += Math.sign(b.x - e.x || fx || 1) * lost; }
    if (w.bottom && fy > 0) { const lost = fy * w.bottom * bend; fy *= 1 - w.bottom * .66; fx += Math.sign(b.x - e.x || fx || 1) * lost; }
    const m = Math.hypot(fx, fy) || 1; return { fx: fx / m * original * .985, fy: fy / m * original * .985 };
  }
  function fieldForce(e, b, dt) {
    if (b.capturedBy) return { ax: 0, ay: 0 };
    const dx = e.x - b.x, dy = e.y - b.y, d = Math.hypot(dx, dy); if (d < .01) return { ax: 0, ay: 0 };
    const w = wallWeights(e), sx = 1 + .9 * (w.left + w.right), sy = 1 + .9 * (w.top + w.bottom);
    if (Math.hypot(dx * sx, dy * sy) >= e.fieldR) return { ax: 0, ay: 0 };
    const tx = dx / d, ty = dy / d, t = clamp(d / e.fieldR, 0, 1), zone = dangerBoost(e); let fx = 0, fy = 0;
    if (e.type === 'repel') {
      const efficiency = 1 - .58 * smooth01(e.heat), pulseBoost = e.pulse > 0 ? 1.18 : 1;
      const strength = 1540 * Math.pow(1 - t, .70) * fadeOut(t, .70) * efficiency * pulseBoost * zone;
      fx = -tx * strength; fy = -ty * strength; e.heat = clamp(e.heat + dt * (.23 + .24 * (1 - t)), 0, 1); if (e.heat >= HEAT_LOCK) e.overheated = true;
    } else {
      const radial = 1900 * Math.exp(-.5 * Math.pow((t - .67) / .20, 2)) * fadeOut(t, .95) * zone;
      fx = tx * radial; fy = ty * radial;
      const tangentX = -ty, tangentY = tx, spin = Math.sign(b.vx * tangentX + b.vy * tangentY || 1);
      const tangential = 2250 * Math.exp(-.5 * Math.pow((t - .54) / .28, 2)) * fadeOut(t, .96) * zone;
      fx += tangentX * spin * tangential; fy += tangentY * spin * tangential;
      const dangerVel = e.side === 'left' ? Math.max(0, -b.vx) : Math.max(0, b.vx); fx += ownerDir(e.side) * dangerVel * 3.4 * fadeOut(t, .93);
    }
    const bent = bendAtWalls(e, b, fx, fy, w); return { ax: bent.fx, ay: bent.fy };
  }

  function updateCapturedBall(dt) {
    const b = state.ball, e = b.capturedBy; if (!e) return false;
    e.captureTime += dt; e.orbitAngle += e.orbitSpin * (4.2 + 1.8 * clamp(e.captureTime / CAPTURE_MAX, 0, 1)) * dt;
    const rr = e.fieldR * (.40 - .055 * clamp(e.captureTime / CAPTURE_MAX, 0, 1));
    b.x = e.x + Math.cos(e.orbitAngle) * rr; b.y = e.y + Math.sin(e.orbitAngle) * rr; b.vx = b.vy = 0;
    b.trail.push({ x: b.x, y: b.y, speed: 760 + e.captureTime * 500 }); if (b.trail.length > 44) b.trail.shift();
    if (e.captureTime >= CAPTURE_MAX) releaseCapture(e, true); return true;
  }
  function updateBall(dt) {
    if (resetTimer > 0) { resetTimer -= dt; return; }
    const b = state.ball; if (updateCapturedBall(dt)) return;
    if (tryNearestCapture()) return;
    const fl = fieldForce(state.left, b, dt), fr = fieldForce(state.right, b, dt); b.vx += (fl.ax + fr.ax) * dt; b.vy += (fl.ay + fr.ay) * dt;
    let sp = speedOf(b); const maxSpeed = 1980; if (sp > maxSpeed) { b.vx = b.vx / sp * maxSpeed; b.vy = b.vy / sp * maxSpeed; sp = maxSpeed; }
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.y - b.r <= 0 && b.vy < 0) { b.y = b.r; b.vy = Math.abs(b.vy) * .99; state.wallTimer = .9; sfx('wall'); }
    else if (b.y + b.r >= WORLD.h && b.vy > 0) { b.y = WORLD.h - b.r; b.vy = -Math.abs(b.vy) * .99; state.wallTimer = .9; sfx('wall'); }
    if (b.x - b.r > WORLD.w) scorePoint('left'); else if (b.x + b.r < 0) scorePoint('right');
    if (running) { b.trail.push({ x: b.x, y: b.y, speed: speedOf(b) }); if (b.trail.length > (sp > 1200 ? 48 : 32)) b.trail.shift(); }
  }

  function registerRally(side) { if (state.lastOwner !== side) { state.rally++; state.rallyTimer = 2.2; state.lastOwner = side; } }
  function burst(x, y, color, count = 10, power = 180) {
    const palette = { left: [255,88,116], right: [93,231,255], gold: [255,214,107] }, c = palette[color] || palette.gold;
    for (let i = 0; i < count; i++) { const a = Math.random() * Math.PI * 2, sp = power * (.35 + Math.random() * .75); state.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: .25 + Math.random() * .36, max: .61, c, r: 1.1 + Math.random() * 2.4 }); }
  }
  function updateParticles(dt) { for (const p of state.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .984; p.vy *= .984; p.life -= dt; } state.particles = state.particles.filter(p => p.life > 0).slice(-240); }
  function updateMeters(e, dt) {
    e.cooldown = Math.max(0, e.cooldown - dt); e.pulse = Math.max(0, e.pulse - dt); e.dashCooldown = Math.max(0, e.dashCooldown - dt); e.dashTime = Math.max(0, e.dashTime - dt);
    if (e.type === 'repel') { const near = !state.ball.capturedBy && Math.hypot(state.ball.x - e.x, state.ball.y - e.y) < e.fieldR; if (!near) e.heat = Math.max(0, e.heat - dt * .34); if (e.overheated && e.heat < .48) e.overheated = false; }
  }
  function update(dt) {
    if (!running || paused) return; if (hitStop > 0) { hitStop -= dt; updateParticles(dt * .3); return; }
    updateMeters(state.left, dt); updateMeters(state.right, dt); state.ball.chargedTime = Math.max(0, state.ball.chargedTime - dt); if (!state.ball.chargedTime) state.ball.chargedBy = null;
    state.rallyTimer = Math.max(0, state.rallyTimer - dt); state.wallTimer = Math.max(0, state.wallTimer - dt); if (!state.rallyTimer && state.rally < 2) state.rally = 0;
    if (feedbackTimer > 0) { feedbackTimer -= dt; if (feedbackTimer <= 0) feedbackEl.classList.remove('show'); }
    shake *= Math.pow(.035, dt); updateHuman(state.left, dt); updateHuman(state.right, dt); enforceZones(); updateBall(dt); updateParticles(dt); updateHud();
  }

  function hudFor(side) {
    return {
      role: $(`${side}Role`), meterLabel: $(`${side}MeterLabel`), meterText: $(`${side}MeterText`), meterFill: $(`${side}MeterFill`), pulse: $(`${side}PulseState`), dash: $(`${side}DashState`)
    };
  }
  function updateHudSide(e) {
    const h = hudFor(e.side); h.role.textContent = e.type === 'attract' ? 'ATTRACTOR' : 'REPULSOR';
    if (e.type === 'repel') { h.meterLabel.textContent = 'HEAT'; h.meterText.textContent = e.overheated ? 'OVERHEAT' : `${Math.round(e.heat * 100)}%`; h.meterFill.style.width = `${e.heat * 100}%`; }
    else { const cap = state.ball.capturedBy === e ? clamp(e.captureTime / CAPTURE_MAX, 0, 1) : 0; h.meterLabel.textContent = 'ORBIT'; h.meterText.textContent = state.ball.capturedBy === e ? (perfectSlingWindow(e) ? 'SUPERCHARGE!' : 'CHARGING') : 'CATCH'; h.meterFill.style.width = `${cap * 100}%`; }
    if (e.type === 'repel' && e.overheated) h.pulse.textContent = 'HOT'; else if (e.cooldown > 0) h.pulse.textContent = `${e.cooldown.toFixed(1)}s`; else if (state.ball.capturedBy === e && perfectSlingWindow(e)) h.pulse.textContent = 'PULSE ORA!'; else h.pulse.textContent = 'READY';
    h.dash.textContent = e.dashCooldown > 0 ? `${e.dashCooldown.toFixed(1)}s` : 'READY';
  }
  function updateHud() {
    $('leftScore').textContent = state.score.left; $('rightScore').textContent = state.score.right; updateHudSide(state.left); updateHudSide(state.right);
    matchPoint.classList.toggle('show', running && Math.max(state.score.left, state.score.right) === targetScore() - 1);
    rallyEl.textContent = state.rally >= 2 ? `RALLY ×${state.rally}` : ''; rallyEl.classList.toggle('show', state.rally >= 2);
    statusLine.textContent = selectedMode === 'polarity' ? 'POLARITY · i ruoli si scambiano dopo ogni punto.' : selectedMode === 'orbit' ? 'ORBIT · cattura, aspetta SUPERCHARGE e premi Pulse.' : 'DUEL · gestisci Heat e cerca il Perfect Parry.';
  }

  function colorFor(e, alpha = 1) { return e.side === 'left' ? `rgba(255,88,116,${alpha})` : `rgba(93,231,255,${alpha})`; }
  function drawBackground() {
    const g = ctx.createLinearGradient(0,0,WORLD.w,WORLD.h); g.addColorStop(0,'#070713'); g.addColorStop(.5,'#050a17'); g.addColorStop(1,'#040814'); ctx.fillStyle=g; ctx.fillRect(0,0,WORLD.w,WORLD.h);
    ctx.fillStyle='rgba(255,255,255,.16)'; for(let i=0;i<55;i++){ctx.globalAlpha=.10+(i%5)*.04;ctx.fillRect((i*347+83)%WORLD.w,(i*173+97)%WORLD.h,i%7===0?2:1,i%7===0?2:1)}ctx.globalAlpha=1;
    ctx.strokeStyle='rgba(255,255,255,.045)';ctx.beginPath();ctx.moveTo(WORLD.w/2,50);ctx.lineTo(WORLD.w/2,WORLD.h-50);ctx.stroke();
    const dz=ctx.createLinearGradient(WORLD.w/3,0,WORLD.w*2/3,0);dz.addColorStop(0,'rgba(255,214,107,0)');dz.addColorStop(.5,'rgba(255,214,107,.045)');dz.addColorStop(1,'rgba(255,214,107,0)');ctx.fillStyle=dz;ctx.fillRect(WORLD.w/3,0,WORLD.w/3,WORLD.h);
  }
  function ringPath(e,r){ctx.beginPath();for(let i=0;i<=80;i++){const a=i/80*Math.PI*2,x=clamp(e.x+Math.cos(a)*r,8,WORLD.w-8),y=clamp(e.y+Math.sin(a)*r,8,WORLD.h-8);if(!i)ctx.moveTo(x,y);else ctx.lineTo(x,y)}}
  function drawEmitter(e){const radii=e.type==='attract'?[.34,.55,.76,1]:[.42,.68,1];for(let i=0;i<radii.length;i++){ringPath(e,e.fieldR*radii[i]);ctx.strokeStyle=colorFor(e,.10+i*.045);ctx.lineWidth=i===radii.length-1?2.1:1.2;ctx.stroke()}
    if(e.type==='repel'&&e.heat>.08){ringPath(e,e.fieldR*.52);ctx.strokeStyle=`rgba(255,214,107,${.08+e.heat*.34})`;ctx.lineWidth=2+e.heat*4;ctx.stroke()}
    if(e.type==='attract'&&state.ball.capturedBy===e){ringPath(e,e.fieldR*.40);ctx.strokeStyle=perfectSlingWindow(e)?'rgba(255,214,107,.95)':'rgba(255,214,107,.32)';ctx.lineWidth=perfectSlingWindow(e)?7:3;ctx.setLineDash([14,12]);ctx.stroke();ctx.setLineDash([])}
    const glow=ctx.createRadialGradient(e.x,e.y,0,e.x,e.y,85);glow.addColorStop(0,colorFor(e,1));glow.addColorStop(.18,colorFor(e,.8));glow.addColorStop(1,colorFor(e,0));ctx.fillStyle=glow;ctx.beginPath();ctx.arc(e.x,e.y,88,0,Math.PI*2);ctx.fill();ctx.strokeStyle=colorFor(e,.9);ctx.lineWidth=3;ctx.beginPath();ctx.arc(e.x,e.y,e.r+13,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#fff';ctx.shadowBlur=24;ctx.shadowColor=colorFor(e,1);ctx.beginPath();ctx.arc(e.x,e.y,11,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0}
  function drawTrail(){const tr=state.ball.trail;for(let i=1;i<tr.length;i++){const a=i/tr.length;let c=`rgba(230,244,255,${a*.18})`;if(state.ball.chargedBy==='left')c=`rgba(255,88,116,${a*.44})`;if(state.ball.chargedBy==='right')c=`rgba(93,231,255,${a*.44})`;ctx.strokeStyle=c;ctx.lineWidth=1+a*(tr[i].speed>1150?8:4);ctx.beginPath();ctx.moveTo(tr[i-1].x,tr[i-1].y);ctx.lineTo(tr[i].x,tr[i].y);ctx.stroke()}}
  function drawBall(){const b=state.ball,sp=speedOf(b),hot=clamp((sp-800)/750,0,1);let glow='255,214,107',core='#fffdf4';if(b.capturedBy===state.left||b.chargedBy==='left'){glow='255,88,116';core='#fff0f3'}else if(b.capturedBy===state.right||b.chargedBy==='right'){glow='93,231,255';core='#edfdff'}const g=ctx.createRadialGradient(b.x,b.y,0,b.x,b.y,70);g.addColorStop(0,core);g.addColorStop(.3,`rgba(${glow},.55)`);g.addColorStop(1,`rgba(${glow},0)`);ctx.fillStyle=g;ctx.beginPath();ctx.arc(b.x,b.y,70+hot*25,0,Math.PI*2);ctx.fill();ctx.fillStyle=core;ctx.shadowBlur=24;ctx.shadowColor=`rgb(${glow})`;ctx.beginPath();ctx.arc(b.x,b.y,b.r+hot*3,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0}
  function drawParticles(){for(const p of state.particles){const a=clamp(p.life/p.max,0,1);ctx.fillStyle=`rgba(${p.c[0]},${p.c[1]},${p.c[2]},${a})`;ctx.beginPath();ctx.arc(p.x,p.y,p.r*a,0,Math.PI*2);ctx.fill()}}
  function draw(){ctx.save();if(shake>.2)ctx.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake);drawBackground();drawEmitter(state.left);drawEmitter(state.right);drawTrail();drawBall();drawParticles();ctx.restore()}
  function loop(now){const dt=Math.min(.05,(now-lastTime)/1000);lastTime=now;accumulator+=dt;const step=1/120;let guard=0;while(accumulator>=step&&guard++<8){update(step);accumulator-=step}draw();requestAnimationFrame(loop)}

  function togglePause(){if(!running)return;paused=!paused;pauseBtn.textContent=paused?'▶ RIPRENDI':'Ⅱ PAUSA';if(paused)feedback('PAUSA','',999999);else{feedbackEl.classList.remove('show');feedbackTimer=0;lastTime=performance.now()}}

  canvas.addEventListener('pointerdown',e=>{initAudio();const p=worldFromClient(e.clientX,e.clientY),side=p.x<WORLD.w/2?'left':'right',now=performance.now();pointers.set(e.pointerId,{side,x:p.x,y:p.y});canvas.setPointerCapture(e.pointerId);if(now-lastTap[side]<285)activateDash(emitterFor(side));lastTap[side]=now});
  canvas.addEventListener('pointermove',e=>{const p0=pointers.get(e.pointerId);if(!p0)return;const p=worldFromClient(e.clientX,e.clientY);p0.x=p.x;p0.y=p.y});
  function releasePointer(e){pointers.delete(e.pointerId);if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId)}
  canvas.addEventListener('pointerup',releasePointer);canvas.addEventListener('pointercancel',releasePointer);

  window.addEventListener('keydown',e=>{const code=e.code;if(['KeyW','KeyA','KeyS','KeyD','Space','ShiftLeft','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter','ShiftRight'].includes(code))e.preventDefault();if(e.repeat){keys.add(code);return}if(code==='Space')activatePulse(state.left);else if(code==='ShiftLeft')activateDash(state.left);else if(code==='Enter')activatePulse(state.right);else if(code==='ShiftRight')activateDash(state.right);else if(code==='Escape'||code==='KeyP')togglePause();else keys.add(code)},{passive:false});
  window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>keys.clear());window.addEventListener('resize',resize);
  $('leftPulseBtn').addEventListener('click',()=>activatePulse(state.left));$('rightPulseBtn').addEventListener('click',()=>activatePulse(state.right));pauseBtn.addEventListener('click',togglePause);resetBtn.addEventListener('click',()=>{if(running)newMatch();else menu.style.display='grid'});startBtn.addEventListener('click',newMatch);
  modeButtons.forEach(b=>b.addEventListener('click',()=>{selectedMode=b.dataset.mode;polarityLeftType='attract';applyMode(false)}));

  applyMode(false);resize();resetPositions();updateHud();requestAnimationFrame(loop);
})();
