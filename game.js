(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const frame = document.getElementById('frame');
  const menu = document.getElementById('menu');
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resetBtn = document.getElementById('resetBtn');
  const pulseBtn = document.getElementById('pulseBtn');
  const pulseState = document.getElementById('pulseState');
  const pulseHint = document.getElementById('pulseHint');
  const playerScoreEl = document.getElementById('playerScore');
  const cpuScoreEl = document.getElementById('cpuScore');
  const playerTypeLabel = document.getElementById('playerTypeLabel');
  const cpuTypeLabel = document.getElementById('cpuTypeLabel');
  const actionFeedback = document.getElementById('actionFeedback');
  const actionTitle = document.getElementById('actionTitle');
  const actionSub = document.getElementById('actionSub');
  const matchPoint = document.getElementById('matchPoint');
  const statusLine = document.getElementById('statusLine');
  const modeButtons = [...document.querySelectorAll('[data-mode]')];
  const difficultyButtons = [...document.querySelectorAll('[data-difficulty]')];
  const polarityWrap = document.getElementById('polarityChoices');
  const polarityButtons = [...document.querySelectorAll('[data-polarity]')];

  const WORLD = { w: 1600, h: 900 };
  const TARGET_SCORE = 7;
  const FIELD_RADIUS = { attract: 430, repel: 392 };
  const PULSE_COOLDOWN = 1.75;
  const PULSE_DURATION = 0.28;
  const keys = new Set();
  const pointer = { active: false, x: 0, y: 0 };

  const MODES = {
    duel: { player: 'repel', cpu: 'repel' },
    orbit: { player: 'attract', cpu: 'attract' },
    polarity: { player: 'attract', cpu: 'repel' }
  };
  const DIFFICULTY = {
    rookie: { speed: 470, thinkMin: .21, thinkJitter: .14, aimError: 105, aggression: .08, pulseChance: 0 },
    rival: { speed: 565, thinkMin: .12, thinkJitter: .09, aimError: 45, aggression: .35, pulseChance: .07 },
    maniac: { speed: 655, thinkMin: .07, thinkJitter: .055, aimError: 20, aggression: .72, pulseChance: .14 }
  };

  let running = false;
  let paused = false;
  let lastTime = performance.now();
  let accumulator = 0;
  let selectedMode = 'duel';
  let selectedPolarity = 'attract';
  let selectedDifficulty = 'rival';
  let resetTimer = 0;
  let hitStop = 0;
  let shake = 0;
  let feedbackTimer = 0;
  let audioCtx = null;

  const state = {
    score: { player: 0, cpu: 0 },
    combo: 0,
    comboTimer: 0,
    lastWallHit: 0,
    lastOwner: null,
    particles: [],
    ball: { x: WORLD.w / 2, y: WORLD.h / 2, vx: 0, vy: 0, r: 14, trail: [] },
    player: { x: WORLD.w * .84, y: WORLD.h / 2, r: 42, type: 'repel', maxSpeed: 735, fieldR: FIELD_RADIUS.repel, pulse: 0, cooldown: 0 },
    cpu: { x: WORLD.w * .16, y: WORLD.h / 2, r: 42, type: 'repel', maxSpeed: 565, fieldR: FIELD_RADIUS.repel, think: 0, targetX: WORLD.w * .16, targetY: WORLD.h / 2, pulse: 0, cooldown: 0 }
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth01 = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const fadeOut = (t, start = .72) => 1 - smooth01((t - start) / (1 - start));
  const opposite = t => t === 'attract' ? 'repel' : 'attract';
  const speedOf = b => Math.hypot(b.vx, b.vy);

  function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  function tone(freq, duration = .07, gain = .035, type = 'sine', glide = 1) {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * glide), t + duration);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(.0001, t + duration);
    o.connect(g).connect(audioCtx.destination);
    o.start(t); o.stop(t + duration);
  }

  function sfx(kind, intensity = 1) {
    if (kind === 'pulse') { tone(150, .16, .055, 'sawtooth', 2.9); tone(430, .12, .03, 'sine', 1.8); }
    if (kind === 'hit') tone(260 + 390 * intensity, .06, .022 + .025 * intensity, 'triangle', .72);
    if (kind === 'wall') tone(180 + 280 * intensity, .045, .018 + .018 * intensity, 'square', .9);
    if (kind === 'point') { tone(420, .13, .05, 'triangle', 1.55); tone(690, .18, .03, 'sine', 1.35); }
    if (kind === 'lose') { tone(250, .16, .04, 'triangle', .72); tone(170, .2, .025, 'sine', .7); }
  }

  function resize() {
    const r = frame.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(canvas.width / WORLD.w, 0, 0, canvas.height / WORLD.h, 0, 0);
  }

  function worldFromClient(x, y) {
    const r = canvas.getBoundingClientRect();
    return { x: (x - r.left) / r.width * WORLD.w, y: (y - r.top) / r.height * WORLD.h };
  }

  function setEmitterType(e, type) {
    e.type = type;
    e.fieldR = FIELD_RADIUS[type];
  }

  function applySettings() {
    const m = MODES[selectedMode];
    if (selectedMode === 'polarity') {
      setEmitterType(state.player, selectedPolarity);
      setEmitterType(state.cpu, opposite(selectedPolarity));
    } else {
      setEmitterType(state.player, m.player);
      setEmitterType(state.cpu, m.cpu);
    }
    state.cpu.maxSpeed = DIFFICULTY[selectedDifficulty].speed;
    playerTypeLabel.textContent = state.player.type === 'attract' ? 'ATTRACTOR' : 'REPULSOR';
    cpuTypeLabel.textContent = state.cpu.type === 'attract' ? 'ATTRACTOR' : 'REPULSOR';
    modeButtons.forEach(b => b.classList.toggle('active', b.dataset.mode === selectedMode));
    difficultyButtons.forEach(b => b.classList.toggle('active', b.dataset.difficulty === selectedDifficulty));
    polarityButtons.forEach(b => b.classList.toggle('active', b.dataset.polarity === selectedPolarity));
    polarityWrap.hidden = selectedMode !== 'polarity';
  }

  function updateHud() {
    playerScoreEl.textContent = state.score.player;
    cpuScoreEl.textContent = state.score.cpu;
    const ready = state.player.cooldown <= 0;
    const pct = clamp(1 - state.player.cooldown / PULSE_COOLDOWN, 0, 1);
    pulseBtn.classList.toggle('cooldown', !ready);
    pulseBtn.style.setProperty('--pulse-rotation', `${pct * 360}deg`);
    pulseState.textContent = ready ? 'READY' : `${state.player.cooldown.toFixed(1)}s`;
    pulseHint.textContent = ready ? 'SPAZIO / TAP' : 'RICARICA';
    const mp = Math.max(state.score.player, state.score.cpu) === TARGET_SCORE - 1;
    matchPoint.classList.toggle('show', running && mp);
  }

  function feedback(title, sub = '', ms = 700) {
    actionTitle.textContent = title;
    actionSub.textContent = sub;
    actionFeedback.classList.add('show');
    feedbackTimer = ms / 1000;
  }

  function resetPositions(serveToward = 0) {
    state.player.x = WORLD.w * .84; state.player.y = WORLD.h / 2;
    state.cpu.x = WORLD.w * .16; state.cpu.y = WORLD.h / 2;
    state.player.pulse = state.cpu.pulse = 0;
    state.player.cooldown = Math.min(state.player.cooldown, .55);
    state.cpu.cooldown = Math.min(state.cpu.cooldown, .8);
    state.combo = 0; state.comboTimer = 0; state.lastWallHit = 0; state.lastOwner = null;
    const b = state.ball;
    b.x = WORLD.w / 2; b.y = WORLD.h / 2 + (Math.random() - .5) * 150;
    const speed = 520, angle = (Math.random() - .5) * .58, sign = serveToward || (Math.random() < .5 ? -1 : 1);
    b.vx = Math.cos(angle) * speed * sign; b.vy = Math.sin(angle) * speed;
    b.trail.length = 0;
    resetTimer = .58;
  }

  function newMatch() {
    initAudio();
    state.score.player = state.score.cpu = 0;
    state.player.cooldown = 0; state.cpu.cooldown = .6;
    paused = false; pauseBtn.textContent = 'Ⅱ PAUSA';
    applySettings(); resetPositions(); updateHud();
    running = true; menu.style.display = 'none';
    lastTime = performance.now(); accumulator = 0;
    feedback('READY', 'PIEGA LA TRAIETTORIA', 520);
  }

  function endMatch(who) {
    running = false;
    updateHud();
    menu.style.display = 'grid';
    document.getElementById('menuTitle').textContent = who === 'player' ? 'Vittoria.' : 'Rivincita?';
    document.getElementById('menuIntro').innerHTML = who === 'player'
      ? `Finale <b>${state.score.player} — ${state.score.cpu}</b>. Hai domato il campo.`
      : `Finale <b>${state.score.player} — ${state.score.cpu}</b>. Il rivale ti ha letto.`;
    startBtn.textContent = 'RIVINCITA';
  }

  function scorePoint(who) {
    state.score[who]++;
    updateHud();
    shake = who === 'player' ? 18 : 11;
    hitStop = .055;
    if (who === 'player') { feedback('PUNTO!', state.combo >= 2 ? `COMBO ×${state.combo}` : 'NICE SHOT', 850); sfx('point'); }
    else { feedback('PUNTO RIVALE', 'RIPRENDI IL CONTROLLO', 760); sfx('lose'); }
    if (state.score[who] >= TARGET_SCORE) return setTimeout(() => endMatch(who), 470);
    resetPositions(who === 'player' ? -1 : 1);
  }

  function moveToward(body, tx, ty, speed, dt) {
    const dx = tx - body.x, dy = ty - body.y, d = Math.hypot(dx, dy);
    if (d < 1) return;
    const s = Math.min(d, speed * dt);
    body.x += dx / d * s; body.y += dy / d * s;
  }

  function enforceZones() {
    state.player.x = clamp(state.player.x, WORLD.w / 3 + state.player.r, WORLD.w - state.player.r);
    state.cpu.x = clamp(state.cpu.x, state.cpu.r, WORLD.w * 2 / 3 - state.cpu.r);
    state.player.y = clamp(state.player.y, state.player.r, WORLD.h - state.player.r);
    state.cpu.y = clamp(state.cpu.y, state.cpu.r, WORLD.h - state.cpu.r);
  }

  function updatePlayer(dt) {
    let tx = state.player.x, ty = state.player.y;
    if (pointer.active) { tx = pointer.x; ty = pointer.y; }
    else {
      let dx = 0, dy = 0;
      if (keys.has('arrowleft') || keys.has('a')) dx--;
      if (keys.has('arrowright') || keys.has('d')) dx++;
      if (keys.has('arrowup') || keys.has('w')) dy--;
      if (keys.has('arrowdown') || keys.has('s')) dy++;
      if (dx || dy) {
        const m = Math.hypot(dx, dy);
        tx += dx / m * state.player.maxSpeed * dt;
        ty += dy / m * state.player.maxSpeed * dt;
      }
    }
    moveToward(state.player, tx, ty, state.player.maxSpeed, dt);
  }

  function reflectedY(y) {
    const span = WORLD.h * 2;
    y = ((y % span) + span) % span;
    return y > WORLD.h ? span - y : y;
  }

  function updateCpu(dt) {
    const c = state.cpu, b = state.ball, dcfg = DIFFICULTY[selectedDifficulty];
    c.think -= dt;
    if (c.think <= 0) {
      c.think = dcfg.thinkMin + Math.random() * dcfg.thinkJitter;
      const travel = clamp((c.x - b.x) / (Math.abs(b.vx) + 330), -.3, .55);
      let py = reflectedY(b.y + b.vy * travel) + (Math.random() - .5) * dcfg.aimError;
      const danger = b.x < WORLD.w * .64 || b.vx < 0;
      const aggressiveX = WORLD.w * (.22 + .15 * dcfg.aggression);
      if (c.type === 'repel') { c.targetX = danger ? b.x - 145 : aggressiveX; c.targetY = py; }
      else {
        c.targetX = danger ? b.x + 132 : aggressiveX;
        const side = Math.sign(b.vy || (b.y - WORLD.h / 2) || 1);
        c.targetY = py + side * (80 + 55 * dcfg.aggression);
      }
      c.targetX = clamp(c.targetX, 70, WORLD.w * 2 / 3 - 58);
      c.targetY = clamp(c.targetY, 65, WORLD.h - 65);

      const dist = Math.hypot(c.x - b.x, c.y - b.y);
      if (c.cooldown <= 0 && dist < c.fieldR * .72 && Math.random() < dcfg.pulseChance) activatePulse(c, false);
    }
    moveToward(c, c.targetX, c.targetY, c.maxSpeed, dt);
  }

  function dangerBoost(emitter) {
    if (emitter === state.player) {
      const t = clamp((WORLD.w * .78 - emitter.x) / (WORLD.w * .45), 0, 1);
      return 1 + .34 * smooth01(t);
    }
    const t = clamp((emitter.x - WORLD.w * .22) / (WORLD.w * .45), 0, 1);
    return 1 + .20 * smooth01(t);
  }

  function activatePulse(emitter, isPlayer = true) {
    if (!running || paused || emitter.cooldown > 0) return;
    initAudio();
    emitter.pulse = PULSE_DURATION;
    emitter.cooldown = PULSE_COOLDOWN;
    if (isPlayer) {
      pulseBtn.classList.remove('firing'); void pulseBtn.offsetWidth; pulseBtn.classList.add('firing');
      feedback('PULSE!', 'TIMING = POTENZA', 420);
      sfx('pulse'); shake = Math.max(shake, 7);
    }
    burst(emitter.x, emitter.y, isPlayer ? 'cyan' : 'red', 24, 260);
  }

  function wallWeights(s) {
    const r = s.fieldR;
    return { left: clamp(1 - s.x / r, 0, 1), right: clamp(1 - (WORLD.w - s.x) / r, 0, 1), top: clamp(1 - s.y / r, 0, 1), bottom: clamp(1 - (WORLD.h - s.y) / r, 0, 1) };
  }

  function bendAtWalls(s, b, fx, fy, w) {
    const original = Math.hypot(fx, fy);
    if (!original) return { fx: 0, fy: 0 };
    const bend = .82;
    if (w.left && fx < 0) { const lost = -fx * w.left * bend; fx *= 1 - w.left * .7; fy += Math.sign(b.y - s.y || fy || 1) * lost; }
    if (w.right && fx > 0) { const lost = fx * w.right * bend; fx *= 1 - w.right * .7; fy += Math.sign(b.y - s.y || fy || 1) * lost; }
    if (w.top && fy < 0) { const lost = -fy * w.top * bend; fy *= 1 - w.top * .7; fx += Math.sign(b.x - s.x || fx || 1) * lost; }
    if (w.bottom && fy > 0) { const lost = fy * w.bottom * bend; fy *= 1 - w.bottom * .7; fx += Math.sign(b.x - s.x || fx || 1) * lost; }
    const m = Math.hypot(fx, fy) || 1, keep = original * .985;
    return { fx: fx / m * keep, fy: fy / m * keep };
  }

  function registerFieldHit(owner, emitter) {
    const b = state.ball;
    const now = performance.now() / 1000;
    const speed = speedOf(b);
    if (state.lastOwner !== owner || now - (registerFieldHit.lastAt || 0) > .22) {
      state.lastOwner = owner; registerFieldHit.lastAt = now;
      if (owner === 'player') {
        state.combo = state.comboTimer > 0 ? state.combo + 1 : 1;
        state.comboTimer = 1.65;
        const wallShot = state.lastWallHit > 0;
        if (emitter.pulse > 0 && speed > 920) feedback('PERFECT PULSE!', `${Math.round(speed)} SPEED`, 610);
        else if (wallShot && speed > 850) feedback(`WALL SLINGSHOT ×${Math.max(2, state.combo)}`, 'SUPERCHARGED', 700);
        else if (speed > 1180) feedback('SUPERCHARGED', `${Math.round(speed)} SPEED`, 520);
        sfx('hit', clamp(speed / 1500, .2, 1));
        if (speed > 1050) { shake = Math.max(shake, 8); hitStop = Math.max(hitStop, .022); }
      }
      burst(b.x, b.y, owner === 'player' ? 'gold' : 'red', speed > 1000 ? 14 : 7, 150 + speed * .08);
    }
  }

  function fieldForce(s, b, owner) {
    const dx = s.x - b.x, dy = s.y - b.y, d = Math.hypot(dx, dy);
    if (d < .01) return { ax: 0, ay: 0 };
    const w = wallWeights(s), sx = 1 + 1.05 * (w.left + w.right), sy = 1 + 1.05 * (w.top + w.bottom);
    if (Math.hypot(dx * sx, dy * sy) >= s.fieldR) return { ax: 0, ay: 0 };
    const tx = dx / d, ty = dy / d, t = clamp(d / s.fieldR, 0, 1);
    const pulseBoost = s.pulse > 0 ? 2.25 : 1;
    const zoneBoost = dangerBoost(s);
    let fx = 0, fy = 0;
    if (s.type === 'repel') {
      const strength = 2650 * Math.pow(1 - t, .56) * fadeOut(t, .71) * pulseBoost * zoneBoost;
      fx = -tx * strength; fy = -ty * strength;
    } else {
      const radialBand = Math.exp(-.5 * Math.pow((t - .43) / .22, 2));
      const radial = 3350 * radialBand * smooth01((t - .015) / .08) * fadeOut(t, .86) * pulseBoost * zoneBoost;
      fx = tx * radial; fy = ty * radial;
      const tangentX = -ty, tangentY = tx;
      const tangentVelocity = b.vx * tangentX + b.vy * tangentY;
      const cross = b.vx * ty - b.vy * tx;
      const spin = Math.sign(tangentVelocity || cross || 1);
      const lateral = Math.abs(tangentVelocity);
      const passQuality = .40 + .60 * smooth01(lateral / 95);
      const orbitBand = Math.exp(-.5 * Math.pow((t - .42) / .29, 2));
      const speedGate = clamp(speedOf(b) / 720, .58, 1.35);
      const tangential = 2480 * orbitBand * smooth01((t - .02) / .06) * fadeOut(t, .90) * speedGate * passQuality * pulseBoost * zoneBoost;
      fx += tangentX * spin * tangential; fy += tangentY * spin * tangential;
    }
    registerFieldHit(owner, s);
    const bent = bendAtWalls(s, b, fx, fy, w);
    return { ax: bent.fx, ay: bent.fy };
  }

  function updateBall(dt) {
    if (resetTimer > 0) { resetTimer -= dt; return; }
    const b = state.ball;
    const fp = fieldForce(state.player, b, 'player');
    const fc = fieldForce(state.cpu, b, 'cpu');
    b.vx += (fp.ax + fc.ax) * dt; b.vy += (fp.ay + fc.ay) * dt;
    const maxSpeed = selectedMode === 'orbit' ? 2050 : 1800;
    let sp = speedOf(b);
    if (sp > maxSpeed) { b.vx = b.vx / sp * maxSpeed; b.vy = b.vy / sp * maxSpeed; sp = maxSpeed; }
    b.x += b.vx * dt; b.y += b.vy * dt;

    let wall = false;
    if (b.y - b.r <= 0 && b.vy < 0) { b.y = b.r; b.vy = Math.abs(b.vy) * .992; wall = true; }
    else if (b.y + b.r >= WORLD.h && b.vy > 0) { b.y = WORLD.h - b.r; b.vy = -Math.abs(b.vy) * .992; wall = true; }
    if (wall) {
      state.lastWallHit = .9;
      sfx('wall', clamp(sp / 1500, .15, 1));
      burst(b.x, b.y, 'gold', sp > 1050 ? 12 : 5, 115 + sp * .06);
      if (sp > 1200) shake = Math.max(shake, 5);
    }

    if (b.x + b.r < 0) scorePoint('player');
    else if (b.x - b.r > WORLD.w) scorePoint('cpu');

    if (running) {
      b.trail.push({ x: b.x, y: b.y, speed: speedOf(b) });
      const maxTrail = speedOf(b) > 1200 ? 50 : 34;
      if (b.trail.length > maxTrail) b.trail.shift();
    }
  }

  function burst(x, y, color, count = 10, power = 180) {
    const palette = { cyan: [93, 231, 255], red: [255, 88, 116], gold: [255, 214, 107] };
    const c = palette[color] || palette.cyan;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, sp = power * (.35 + Math.random() * .75);
      state.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: .28 + Math.random() * .38, max: .66, c, r: 1.2 + Math.random() * 2.6 });
    }
  }

  function updateParticles(dt) {
    for (const p of state.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .985; p.vy *= .985; p.life -= dt; }
    state.particles = state.particles.filter(p => p.life > 0).slice(-220);
  }

  function update(dt) {
    if (!running || paused) return;
    if (hitStop > 0) { hitStop -= dt; updateParticles(dt * .3); return; }
    state.player.cooldown = Math.max(0, state.player.cooldown - dt);
    state.cpu.cooldown = Math.max(0, state.cpu.cooldown - dt);
    state.player.pulse = Math.max(0, state.player.pulse - dt);
    state.cpu.pulse = Math.max(0, state.cpu.pulse - dt);
    state.comboTimer = Math.max(0, state.comboTimer - dt);
    state.lastWallHit = Math.max(0, state.lastWallHit - dt);
    if (!state.comboTimer) state.combo = 0;
    if (feedbackTimer > 0) { feedbackTimer -= dt; if (feedbackTimer <= 0) actionFeedback.classList.remove('show'); }
    shake *= Math.pow(.035, dt);
    updatePlayer(dt); updateCpu(dt); enforceZones(); updateBall(dt); updateParticles(dt); updateHud();
  }

  function colorForEmitter(s, alpha = 1) {
    const c = s === state.player ? [93, 231, 255] : [255, 88, 116];
    return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
  }

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, WORLD.w, WORLD.h);
    g.addColorStop(0, '#040814'); g.addColorStop(.48, '#050a17'); g.addColorStop(1, '#070713');
    ctx.fillStyle = g; ctx.fillRect(0, 0, WORLD.w, WORLD.h);

    const rg = ctx.createRadialGradient(WORLD.w * .76, WORLD.h * .38, 20, WORLD.w * .76, WORLD.h * .38, 580);
    rg.addColorStop(0, 'rgba(30,118,190,.08)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, WORLD.w, WORLD.h);
    const rr = ctx.createRadialGradient(WORLD.w * .18, WORLD.h * .58, 20, WORLD.w * .18, WORLD.h * .58, 560);
    rr.addColorStop(0, 'rgba(150,28,52,.055)'); rr.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rr; ctx.fillRect(0, 0, WORLD.w, WORLD.h);

    ctx.fillStyle = 'rgba(255,255,255,.20)';
    for (let i = 0; i < 58; i++) {
      const x = (i * 347 + 83) % WORLD.w, y = (i * 173 + 97) % WORLD.h;
      const r = i % 7 === 0 ? 2 : 1;
      ctx.globalAlpha = .16 + (i % 5) * .05; ctx.fillRect(x, y, r, r);
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = 'rgba(255,255,255,.035)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(WORLD.w / 2, 55); ctx.lineTo(WORLD.w / 2, WORLD.h - 55); ctx.stroke();

    const dangerL = WORLD.w / 3, dangerR = WORLD.w * 2 / 3;
    const dz = ctx.createLinearGradient(dangerL, 0, dangerR, 0);
    dz.addColorStop(0, 'rgba(255,214,107,0)'); dz.addColorStop(.5, 'rgba(255,214,107,.055)'); dz.addColorStop(1, 'rgba(255,214,107,0)');
    ctx.fillStyle = dz; ctx.fillRect(dangerL, 0, dangerR - dangerL, WORLD.h);
    ctx.fillStyle = 'rgba(255,214,107,.15)'; ctx.font = '700 12px system-ui'; ctx.textAlign = 'center'; ctx.fillText('DANGER ZONE · FIELD BOOST', WORLD.w / 2, 31);
  }

  function deformRingPoint(s, r, a) {
    let x = s.x + Math.cos(a) * r, y = s.y + Math.sin(a) * r;
    const slide = .68, m = 10;
    if (x < m) { const o = m - x; x = m; y += Math.sign(y - s.y || 1) * o * slide; }
    if (x > WORLD.w - m) { const o = x - (WORLD.w - m); x = WORLD.w - m; y += Math.sign(y - s.y || 1) * o * slide; }
    if (y < m) { const o = m - y; y = m; x += Math.sign(x - s.x || 1) * o * slide; }
    if (y > WORLD.h - m) { const o = y - (WORLD.h - m); y = WORLD.h - m; x += Math.sign(x - s.x || 1) * o * slide; }
    return { x: clamp(x, m, WORLD.w - m), y: clamp(y, m, WORLD.h - m) };
  }

  function ringPath(s, r) {
    ctx.beginPath();
    for (let i = 0; i <= 96; i++) {
      const p = deformRingPoint(s, r, i / 96 * Math.PI * 2);
      if (!i) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
  }

  function drawEmitter(s) {
    const pulse = s.pulse > 0 ? s.pulse / PULSE_DURATION : 0;
    const boost = dangerBoost(s);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 4; i >= 1; i--) {
      const r = s.fieldR * (i / 4) * (1 + .035 * Math.sin(performance.now() * .003 + i));
      ringPath(s, r);
      ctx.strokeStyle = colorForEmitter(s, .08 + .055 * i + pulse * .08);
      ctx.lineWidth = i === 4 ? 2.6 : 1.4;
      ctx.stroke();
    }

    const glow = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, 115 + pulse * 45);
    glow.addColorStop(0, colorForEmitter(s, .92)); glow.addColorStop(.18, colorForEmitter(s, .30)); glow.addColorStop(1, colorForEmitter(s, 0));
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(s.x, s.y, 120 + pulse * 42, 0, Math.PI * 2); ctx.fill();

    ctx.strokeStyle = colorForEmitter(s, .7); ctx.lineWidth = 4;
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(s.x, s.y, 32 + i * 15 + pulse * 10, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = '#f8fdff'; ctx.shadowColor = colorForEmitter(s, 1); ctx.shadowBlur = 28 + pulse * 22;
    ctx.beginPath(); ctx.arc(s.x, s.y, 12 + pulse * 4, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    const arrows = 12;
    ctx.fillStyle = colorForEmitter(s, .45);
    for (let i = 0; i < arrows; i++) {
      const a = i / arrows * Math.PI * 2 + performance.now() * .00035 * (s.type === 'attract' ? 1 : -1);
      const rr = s.fieldR * .67;
      const x = s.x + Math.cos(a) * rr, y = s.y + Math.sin(a) * rr;
      ctx.save(); ctx.translate(x, y); ctx.rotate(a + (s.type === 'attract' ? Math.PI : 0));
      ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, -4); ctx.lineTo(-2, 0); ctx.lineTo(-5, 4); ctx.closePath(); ctx.fill(); ctx.restore();
    }

    if (boost > 1.05) {
      ctx.strokeStyle = 'rgba(255,214,107,.28)'; ctx.lineWidth = 3; ctx.setLineDash([12, 12]);
      ctx.beginPath(); ctx.arc(s.x, s.y, s.fieldR * .83, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
  }

  function drawBall() {
    const b = state.ball, sp = speedOf(b);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 1; i < b.trail.length; i++) {
      const p0 = b.trail[i - 1], p1 = b.trail[i];
      const t = i / b.trail.length, fast = clamp(p1.speed / 1500, 0, 1);
      ctx.strokeStyle = `rgba(255,${Math.round(226 + fast * 25)},${Math.round(170 + fast * 80)},${t * (.10 + fast * .55)})`;
      ctx.lineWidth = 2 + t * (2 + fast * 8);
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
    }
    const rg = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, 58 + clamp(sp / 35, 0, 34));
    rg.addColorStop(0, '#ffffff'); rg.addColorStop(.2, sp > 1050 ? '#fff1b4' : '#eafaff'); rg.addColorStop(1, 'rgba(255,214,107,0)');
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(b.x, b.y, 62, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.shadowColor = sp > 1050 ? '#ffd66b' : '#bdefff'; ctx.shadowBlur = 26;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r + clamp(sp / 500, 0, 4), 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawParticles() {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const p of state.particles) {
      const a = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = `rgba(${p.c[0]},${p.c[1]},${p.c[2]},${a})`;
      ctx.fillRect(p.x, p.y, p.r, p.r);
    }
    ctx.restore();
  }

  function drawArenaEdge() {
    ctx.save(); ctx.lineWidth = 4; ctx.shadowBlur = 18;
    const lg = ctx.createLinearGradient(0, 0, WORLD.w, 0);
    lg.addColorStop(0, 'rgba(255,88,116,.78)'); lg.addColorStop(.42, 'rgba(255,255,255,.12)'); lg.addColorStop(.58, 'rgba(255,255,255,.12)'); lg.addColorStop(1, 'rgba(93,231,255,.82)');
    ctx.strokeStyle = lg; ctx.shadowColor = 'rgba(93,231,255,.22)';
    ctx.strokeRect(9, 9, WORLD.w - 18, WORLD.h - 18);
    ctx.restore();
  }

  function render() {
    const sx = shake > .1 ? (Math.random() - .5) * shake : 0;
    const sy = shake > .1 ? (Math.random() - .5) * shake : 0;
    ctx.save(); ctx.translate(sx, sy);
    drawBackground(); drawEmitter(state.cpu); drawEmitter(state.player); drawBall(); drawParticles(); drawArenaEdge();
    ctx.restore();
  }

  function frameLoop(now) {
    const elapsed = Math.min(.05, (now - lastTime) / 1000); lastTime = now;
    accumulator += elapsed;
    const step = 1 / 120;
    while (accumulator >= step) { update(step); accumulator -= step; }
    render(); requestAnimationFrame(frameLoop);
  }

  modeButtons.forEach(b => b.addEventListener('click', () => { selectedMode = b.dataset.mode; applySettings(); }));
  difficultyButtons.forEach(b => b.addEventListener('click', () => { selectedDifficulty = b.dataset.difficulty; applySettings(); }));
  polarityButtons.forEach(b => b.addEventListener('click', () => { selectedPolarity = b.dataset.polarity; applySettings(); }));
  startBtn.addEventListener('click', newMatch);
  resetBtn.addEventListener('click', () => { document.getElementById('menuTitle').textContent = 'Difendi il tuo lato.'; document.getElementById('menuIntro').innerHTML = 'Muovi il generatore, piega la traiettoria e usa <b>PULSE</b> nel momento giusto.'; startBtn.textContent = 'PLAY — PRIMO A 7'; running = false; menu.style.display = 'grid'; updateHud(); });
  pauseBtn.addEventListener('click', () => { if (!running) return; paused = !paused; pauseBtn.textContent = paused ? '▶ RIPRENDI' : 'Ⅱ PAUSA'; feedback(paused ? 'PAUSA' : 'GO!', paused ? 'RIPRENDI QUANDO VUOI' : '', 420); });
  pulseBtn.addEventListener('click', e => { e.stopPropagation(); activatePulse(state.player, true); });

  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (['arrowleft','arrowright','arrowup','arrowdown',' ','a','s','d','w'].includes(k)) e.preventDefault();
    if (k === ' ' && !e.repeat) activatePulse(state.player, true);
    keys.add(k);
  }, { passive: false });
  window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));

  canvas.addEventListener('pointerdown', e => { initAudio(); pointer.active = true; const p = worldFromClient(e.clientX, e.clientY); pointer.x = p.x; pointer.y = p.y; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => { if (!pointer.active) return; const p = worldFromClient(e.clientX, e.clientY); pointer.x = p.x; pointer.y = p.y; });
  canvas.addEventListener('pointerup', e => { pointer.active = false; try { canvas.releasePointerCapture(e.pointerId); } catch {} });
  canvas.addEventListener('pointercancel', () => pointer.active = false);

  window.addEventListener('resize', resize);
  applySettings(); resize(); resetPositions(); updateHud(); render(); requestAnimationFrame(frameLoop);
  statusLine.textContent = 'PULSE pronto · entra verso il centro per aumentare la forza.';
})();
