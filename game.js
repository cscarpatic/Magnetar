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
  const pulseBtn = $('pulseBtn');
  const pulseState = $('pulseState');
  const pulseHint = $('pulseHint');
  const playerScoreEl = $('playerScore');
  const cpuScoreEl = $('cpuScore');
  const playerTypeLabel = $('playerTypeLabel');
  const cpuTypeLabel = $('cpuTypeLabel');
  const actionFeedback = $('actionFeedback');
  const actionTitle = $('actionTitle');
  const actionSub = $('actionSub');
  const matchPoint = $('matchPoint');
  const statusLine = $('statusLine');

  const modeButtons = [...document.querySelectorAll('[data-mode]')];
  const difficultyButtons = [...document.querySelectorAll('[data-difficulty]')];
  const polarityWrap = $('polarityChoices');
  const polarityButtons = [...document.querySelectorAll('[data-polarity]')];

  const WORLD = { w: 1600, h: 900 };
  const TARGET_SCORE = 7;
  const FIELD_RADIUS = { attract: 470, repel: 355 };
  const PULSE_DURATION = { attract: .24, repel: .24 };
  const PULSE_COOLDOWN = { attract: 1.48, repel: 2.05 };
  const keys = new Set();
  const pointer = { active: false, x: 0, y: 0 };

  const MODES = {
    duel: { player: 'repel', cpu: 'repel' },
    orbit: { player: 'attract', cpu: 'attract' },
    polarity: { player: 'attract', cpu: 'repel' }
  };

  const DIFFICULTY = {
    rookie: { speed: 455, thinkMin: .22, thinkJitter: .15, aimError: 115, aggression: .06, pulseChance: .00 },
    rival: { speed: 545, thinkMin: .14, thinkJitter: .10, aimError: 58, aggression: .28, pulseChance: .045 },
    maniac: { speed: 625, thinkMin: .085, thinkJitter: .065, aimError: 27, aggression: .62, pulseChance: .095 }
  };

  let running = false;
  let paused = false;
  let lastTime = performance.now();
  let accumulator = 0;
  let resetTimer = 0;
  let selectedMode = 'duel';
  let selectedPolarity = 'attract';
  let selectedDifficulty = 'rival';
  let feedbackTimer = 0;
  let hitStop = 0;
  let shake = 0;
  let audioCtx = null;

  const state = {
    score: { player: 0, cpu: 0 },
    combo: 0,
    comboTimer: 0,
    lastOwner: null,
    lastFieldHitAt: 0,
    lastWallHit: 0,
    particles: [],
    ball: { x: WORLD.w / 2, y: WORLD.h / 2, vx: 0, vy: 0, r: 14, trail: [] },
    player: { x: WORLD.w * .84, y: WORLD.h / 2, r: 42, type: 'repel', maxSpeed: 735, fieldR: FIELD_RADIUS.repel, pulse: 0, cooldown: 0, capture: 0 },
    cpu: { x: WORLD.w * .16, y: WORLD.h / 2, r: 42, type: 'repel', maxSpeed: 545, fieldR: FIELD_RADIUS.repel, think: 0, targetX: WORLD.w * .16, targetY: WORLD.h / 2, pulse: 0, cooldown: 0, capture: 0 }
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth01 = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const fadeOut = (t, start = .72) => 1 - smooth01((t - start) / (1 - start));
  const opposite = t => t === 'attract' ? 'repel' : 'attract';
  const speedOf = b => Math.hypot(b.vx, b.vy);
  const ownerDir = owner => owner === 'player' ? -1 : 1;

  function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  function tone(freq, duration = .07, gain = .03, type = 'sine', glide = 1) {
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
    if (kind === 'pulse') { tone(150, .15, .05, 'sawtooth', 2.7); tone(410, .12, .025, 'sine', 1.7); }
    if (kind === 'sling') { tone(240, .11, .045, 'triangle', 2.8); tone(720, .16, .025, 'sine', 1.5); }
    if (kind === 'hit') tone(250 + 360 * intensity, .06, .018 + .022 * intensity, 'triangle', .76);
    if (kind === 'wall') tone(180 + 250 * intensity, .045, .018, 'square', .9);
    if (kind === 'point') { tone(430, .13, .045, 'triangle', 1.55); tone(710, .17, .028, 'sine', 1.3); }
    if (kind === 'lose') { tone(240, .15, .035, 'triangle', .72); tone(165, .19, .022, 'sine', .72); }
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
    e.capture = 0;
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
    updateStatus();
  }

  function updateStatus() {
    if (!statusLine) return;
    if (state.player.type === 'attract') {
      const charged = state.player.capture > .5 ? ' · CARICA PRONTA' : '';
      statusLine.textContent = `ATTRACTOR: entra nella fascia, cattura la palla e usa PULSE per spararla${charged}.`;
    } else {
      statusLine.textContent = 'REPULSOR: difendi con il posizionamento. PULSE è forte, ma ricarica più lentamente.';
    }
  }

  function updateHud() {
    playerScoreEl.textContent = state.score.player;
    cpuScoreEl.textContent = state.score.cpu;
    const cd = PULSE_COOLDOWN[state.player.type];
    const ready = state.player.cooldown <= 0;
    const pct = clamp(1 - state.player.cooldown / cd, 0, 1);
    pulseBtn.classList.toggle('cooldown', !ready);
    pulseBtn.style.setProperty('--pulse-rotation', `${pct * 360}deg`);
    if (ready && state.player.type === 'attract' && state.player.capture > .5) {
      pulseState.textContent = 'CHARGED';
      pulseHint.textContent = 'SLINGSHOT!';
    } else {
      pulseState.textContent = ready ? 'READY' : `${state.player.cooldown.toFixed(1)}s`;
      pulseHint.textContent = ready ? 'SPAZIO / TAP' : 'RICARICA';
    }
    matchPoint.classList.toggle('show', running && Math.max(state.score.player, state.score.cpu) === TARGET_SCORE - 1);
    updateStatus();
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
    for (const e of [state.player, state.cpu]) { e.pulse = 0; e.capture = 0; }
    state.player.cooldown = Math.min(state.player.cooldown, .45);
    state.cpu.cooldown = Math.min(state.cpu.cooldown, .65);
    state.combo = 0; state.comboTimer = 0; state.lastOwner = null; state.lastWallHit = 0;
    const b = state.ball;
    b.x = WORLD.w / 2;
    b.y = WORLD.h / 2 + (Math.random() - .5) * 150;
    const speed = 510, angle = (Math.random() - .5) * .55, sign = serveToward || (Math.random() < .5 ? -1 : 1);
    b.vx = Math.cos(angle) * speed * sign;
    b.vy = Math.sin(angle) * speed;
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
    feedback(state.player.type === 'attract' ? 'CATTURA → PULSE' : 'POSIZIONA → PULSE', state.player.type === 'attract' ? 'L’ATTRACTOR ORA È UNO SLINGSHOT' : 'DIFESA PRECISA, MENO AUTOMATICA', 900);
  }

  function endMatch(who) {
    running = false;
    updateHud();
    menu.style.display = 'grid';
    $('menuTitle').textContent = who === 'player' ? 'Vittoria.' : 'Rivincita?';
    $('menuIntro').innerHTML = who === 'player'
      ? `Finale <b>${state.score.player} — ${state.score.cpu}</b>. Hai domato il campo.`
      : `Finale <b>${state.score.player} — ${state.score.cpu}</b>. Cambia approccio e riprova.`;
    startBtn.textContent = 'RIVINCITA';
  }

  function scorePoint(who) {
    state.score[who]++;
    updateHud();
    shake = who === 'player' ? 17 : 10;
    hitStop = .05;
    if (who === 'player') { feedback('PUNTO!', state.combo >= 2 ? `COMBO ×${state.combo}` : 'NICE SHOT', 820); sfx('point'); }
    else { feedback('PUNTO RIVALE', 'RIPRENDI IL CONTROLLO', 720); sfx('lose'); }
    if (state.score[who] >= TARGET_SCORE) return setTimeout(() => endMatch(who), 430);
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
      const travel = clamp((c.x - b.x) / (Math.abs(b.vx) + 340), -.28, .52);
      let py = reflectedY(b.y + b.vy * travel) + (Math.random() - .5) * dcfg.aimError;
      const danger = b.x < WORLD.w * .62 || b.vx < 0;
      const home = WORLD.w * (.18 + .12 * dcfg.aggression);
      if (c.type === 'repel') {
        c.targetX = danger ? b.x - 175 : home;
        c.targetY = py;
      } else {
        c.targetX = danger ? b.x + 105 : home + 45;
        const side = Math.sign(b.vy || (b.y - WORLD.h / 2) || 1);
        c.targetY = py + side * (65 + 45 * dcfg.aggression);
      }
      c.targetX = clamp(c.targetX, 70, WORLD.w * 2 / 3 - 58);
      c.targetY = clamp(c.targetY, 65, WORLD.h - 65);

      const dist = Math.hypot(c.x - b.x, c.y - b.y);
      const chance = c.type === 'attract' ? dcfg.pulseChance * 1.15 : dcfg.pulseChance * .72;
      const wantsSling = c.type === 'attract' && c.capture > .38;
      if (c.cooldown <= 0 && dist < c.fieldR * .82 && (wantsSling || Math.random() < chance)) activatePulse(c, false);
    }
    moveToward(c, c.targetX, c.targetY, c.maxSpeed, dt);
  }

  function dangerBoost(s) {
    const forward = s === state.player
      ? clamp((WORLD.w * .78 - s.x) / (WORLD.w * .45), 0, 1)
      : clamp((s.x - WORLD.w * .22) / (WORLD.w * .45), 0, 1);
    return 1 + (s.type === 'attract' ? .38 : .13) * smooth01(forward);
  }

  function pulseRelease(emitter, owner) {
    const b = state.ball;
    const dx = b.x - emitter.x, dy = b.y - emitter.y;
    const d = Math.hypot(dx, dy);
    if (d > emitter.fieldR * 1.02) return false;

    const dir = ownerDir(owner);
    const sp = speedOf(b);
    if (emitter.type === 'attract') {
      const charge = emitter.capture;
      const side = Math.sign(dy || b.vy || 1);
      const launch = 520 + 620 * charge;
      b.vx += dir * (launch + sp * .22);
      b.vy += side * (170 + 250 * charge);
      const minSpeed = 980 + 430 * charge;
      const after = speedOf(b) || 1;
      if (after < minSpeed) { b.vx = b.vx / after * minSpeed; b.vy = b.vy / after * minSpeed; }
      emitter.capture = 0;
      if (owner === 'player') {
        feedback(charge > .55 ? 'PERFECT SLINGSHOT!' : 'SLINGSHOT!', `${Math.round(speedOf(b))} SPEED`, 720);
        sfx('sling'); shake = Math.max(shake, 10); hitStop = Math.max(hitStop, .025);
      }
      burst(b.x, b.y, owner === 'player' ? 'gold' : 'red', 20, 260);
      return true;
    }

    const nx = dx / (d || 1), ny = dy / (d || 1);
    b.vx += nx * 360; b.vy += ny * 360;
    return true;
  }

  function activatePulse(emitter, isPlayer = true) {
    if (!running || paused || emitter.cooldown > 0) return;
    initAudio();
    const owner = emitter === state.player ? 'player' : 'cpu';
    emitter.pulse = PULSE_DURATION[emitter.type];
    emitter.cooldown = PULSE_COOLDOWN[emitter.type];
    const released = pulseRelease(emitter, owner);
    if (isPlayer) {
      pulseBtn.classList.remove('firing'); void pulseBtn.offsetWidth; pulseBtn.classList.add('firing');
      if (!released || emitter.type === 'repel') feedback('PULSE!', emitter.type === 'repel' ? 'RESPINTA BREVE' : 'AVVICINA LA PALLA PRIMA', 420);
      sfx('pulse'); shake = Math.max(shake, 6);
    }
    burst(emitter.x, emitter.y, isPlayer ? 'cyan' : 'red', 20, 230);
  }

  function wallWeights(s) {
    const r = s.fieldR;
    return { left: clamp(1 - s.x / r, 0, 1), right: clamp(1 - (WORLD.w - s.x) / r, 0, 1), top: clamp(1 - s.y / r, 0, 1), bottom: clamp(1 - (WORLD.h - s.y) / r, 0, 1) };
  }

  function bendAtWalls(s, b, fx, fy, w) {
    const original = Math.hypot(fx, fy);
    if (!original) return { fx: 0, fy: 0 };
    const bend = .8;
    if (w.left && fx < 0) { const lost = -fx * w.left * bend; fx *= 1 - w.left * .68; fy += Math.sign(b.y - s.y || fy || 1) * lost; }
    if (w.right && fx > 0) { const lost = fx * w.right * bend; fx *= 1 - w.right * .68; fy += Math.sign(b.y - s.y || fy || 1) * lost; }
    if (w.top && fy < 0) { const lost = -fy * w.top * bend; fy *= 1 - w.top * .68; fx += Math.sign(b.x - s.x || fx || 1) * lost; }
    if (w.bottom && fy > 0) { const lost = fy * w.bottom * bend; fy *= 1 - w.bottom * .68; fx += Math.sign(b.x - s.x || fx || 1) * lost; }
    const m = Math.hypot(fx, fy) || 1;
    return { fx: fx / m * original * .985, fy: fy / m * original * .985 };
  }

  function registerFieldHit(owner, emitter) {
    const now = performance.now() / 1000;
    const b = state.ball;
    const speed = speedOf(b);
    if (state.lastOwner !== owner || now - state.lastFieldHitAt > .24) {
      state.lastOwner = owner; state.lastFieldHitAt = now;
      if (owner === 'player') {
        state.combo = state.comboTimer > 0 ? state.combo + 1 : 1;
        state.comboTimer = 1.75;
        if (state.lastWallHit > 0 && speed > 900) feedback(`WALL SHOT ×${Math.max(2, state.combo)}`, 'KEEP IT MOVING', 620);
        else if (speed > 1250) feedback('SUPERCHARGED', `${Math.round(speed)} SPEED`, 500);
        sfx('hit', clamp(speed / 1500, .2, 1));
        if (speed > 1100) shake = Math.max(shake, 6);
      }
      burst(b.x, b.y, owner === 'player' ? 'gold' : 'red', speed > 1000 ? 10 : 5, 130 + speed * .06);
    }
  }

  function fieldForce(s, b, owner, dt) {
    const dx = s.x - b.x, dy = s.y - b.y, d = Math.hypot(dx, dy);
    if (d < .01) return { ax: 0, ay: 0, inside: true };
    const w = wallWeights(s);
    const sx = 1 + .92 * (w.left + w.right), sy = 1 + .92 * (w.top + w.bottom);
    if (Math.hypot(dx * sx, dy * sy) >= s.fieldR) {
      if (s.type === 'attract') s.capture = Math.max(0, s.capture - dt * 1.8);
      return { ax: 0, ay: 0, inside: false };
    }

    const tx = dx / d, ty = dy / d, t = clamp(d / s.fieldR, 0, 1);
    const zone = dangerBoost(s);
    let fx = 0, fy = 0;

    if (s.type === 'repel') {
      const pulseBoost = s.pulse > 0 ? 1.62 : 1;
      const strength = 2180 * Math.pow(1 - t, .62) * fadeOut(t, .70) * pulseBoost * zone;
      fx = -tx * strength; fy = -ty * strength;
    } else {
      const outerCatch = Math.exp(-.5 * Math.pow((t - .62) / .23, 2));
      const radial = 1900 * outerCatch * smooth01((t - .10) / .15) * fadeOut(t, .92) * zone;
      fx = tx * radial; fy = ty * radial;

      const tangentX = -ty, tangentY = tx;
      const tangentVelocity = b.vx * tangentX + b.vy * tangentY;
      const cross = b.vx * ty - b.vy * tx;
      const spin = Math.sign(tangentVelocity || cross || 1);
      const lateral = Math.abs(tangentVelocity);
      const passQuality = .62 + .38 * smooth01(lateral / 110);
      const orbitBand = Math.exp(-.5 * Math.pow((t - .48) / .32, 2));
      const tangential = 3650 * orbitBand * fadeOut(t, .95) * passQuality * zone;
      fx += tangentX * spin * tangential;
      fy += tangentY * spin * tangential;

      const dir = ownerDir(owner);
      const goalward = owner === 'player' ? Math.max(0, b.vx) : Math.max(0, -b.vx);
      const assist = smooth01((.82 - t) / .55);
      fx += dir * goalward * 2.15 * assist;
      fx += dir * 760 * smooth01((.72 - t) / .48) * zone;

      const captureZone = t < .78;
      if (captureZone) s.capture = clamp(s.capture + dt * (1.15 + .75 * (1 - t)), 0, 1);
      else s.capture = Math.max(0, s.capture - dt * .7);
    }

    registerFieldHit(owner, s);
    const bent = bendAtWalls(s, b, fx, fy, w);
    return { ax: bent.fx, ay: bent.fy, inside: true };
  }

  function updateBall(dt) {
    if (resetTimer > 0) { resetTimer -= dt; return; }
    const b = state.ball;
    const fp = fieldForce(state.player, b, 'player', dt);
    const fc = fieldForce(state.cpu, b, 'cpu', dt);
    b.vx += (fp.ax + fc.ax) * dt;
    b.vy += (fp.ay + fc.ay) * dt;

    let sp = speedOf(b);
    const maxSpeed = 1950;
    if (sp > maxSpeed) { b.vx = b.vx / sp * maxSpeed; b.vy = b.vy / sp * maxSpeed; sp = maxSpeed; }
    b.x += b.vx * dt; b.y += b.vy * dt;

    let wall = false;
    if (b.y - b.r <= 0 && b.vy < 0) { b.y = b.r; b.vy = Math.abs(b.vy) * .99; wall = true; }
    else if (b.y + b.r >= WORLD.h && b.vy > 0) { b.y = WORLD.h - b.r; b.vy = -Math.abs(b.vy) * .99; wall = true; }
    if (wall) {
      state.lastWallHit = .9;
      sfx('wall', clamp(sp / 1500, .15, 1));
      burst(b.x, b.y, 'gold', sp > 1050 ? 10 : 5, 110 + sp * .055);
    }

    if (b.x + b.r < 0) scorePoint('player');
    else if (b.x - b.r > WORLD.w) scorePoint('cpu');

    if (running) {
      b.trail.push({ x: b.x, y: b.y, speed: speedOf(b) });
      const maxTrail = speedOf(b) > 1200 ? 48 : 32;
      if (b.trail.length > maxTrail) b.trail.shift();
    }
  }

  function burst(x, y, color, count = 10, power = 180) {
    const palette = { cyan: [93, 231, 255], red: [255, 88, 116], gold: [255, 214, 107] };
    const c = palette[color] || palette.cyan;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, sp = power * (.35 + Math.random() * .75);
      state.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: .25 + Math.random() * .38, max: .63, c, r: 1.2 + Math.random() * 2.5 });
    }
  }

  function updateParticles(dt) {
    for (const p of state.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .984; p.vy *= .984; p.life -= dt; }
    state.particles = state.particles.filter(p => p.life > 0).slice(-210);
  }

  function update(dt) {
    if (!running || paused) return;
    if (hitStop > 0) { hitStop -= dt; updateParticles(dt * .3); return; }
    for (const e of [state.player, state.cpu]) {
      e.cooldown = Math.max(0, e.cooldown - dt);
      e.pulse = Math.max(0, e.pulse - dt);
    }
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
    g.addColorStop(0, '#040814'); g.addColorStop(.5, '#050a17'); g.addColorStop(1, '#070713');
    ctx.fillStyle = g; ctx.fillRect(0, 0, WORLD.w, WORLD.h);

    const blue = ctx.createRadialGradient(WORLD.w * .76, WORLD.h * .38, 20, WORLD.w * .76, WORLD.h * .38, 580);
    blue.addColorStop(0, 'rgba(30,118,190,.08)'); blue.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = blue; ctx.fillRect(0, 0, WORLD.w, WORLD.h);
    const red = ctx.createRadialGradient(WORLD.w * .18, WORLD.h * .58, 20, WORLD.w * .18, WORLD.h * .58, 560);
    red.addColorStop(0, 'rgba(150,28,52,.055)'); red.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = red; ctx.fillRect(0, 0, WORLD.w, WORLD.h);

    ctx.fillStyle = 'rgba(255,255,255,.20)';
    for (let i = 0; i < 58; i++) {
      const x = (i * 347 + 83) % WORLD.w, y = (i * 173 + 97) % WORLD.h;
      ctx.globalAlpha = .12 + (i % 5) * .045; ctx.fillRect(x, y, i % 7 === 0 ? 2 : 1, i % 7 === 0 ? 2 : 1);
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = 'rgba(255,255,255,.035)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(WORLD.w / 2, 55); ctx.lineTo(WORLD.w / 2, WORLD.h - 55); ctx.stroke();

    const dangerL = WORLD.w / 3, dangerR = WORLD.w * 2 / 3;
    const dz = ctx.createLinearGradient(dangerL, 0, dangerR, 0);
    dz.addColorStop(0, 'rgba(255,214,107,0)'); dz.addColorStop(.5, 'rgba(255,214,107,.055)'); dz.addColorStop(1, 'rgba(255,214,107,0)');
    ctx.fillStyle = dz; ctx.fillRect(dangerL, 0, dangerR - dangerL, WORLD.h);
    ctx.fillStyle = 'rgba(255,214,107,.14)'; ctx.font = '700 12px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('DANGER ZONE · ATTRACTOR +38% · REPULSOR +13%', WORLD.w / 2, 31);
  }

  function deformRingPoint(s, r, a) {
    let x = s.x + Math.cos(a) * r, y = s.y + Math.sin(a) * r;
    const slide = .64, m = 10;
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
    const pulse = s.pulse > 0 ? 1 : 0;
    const capture = s.type === 'attract' ? s.capture : 0;
    const c = colorForEmitter(s, 1);
    const radii = s.type === 'attract' ? [.34, .55, .76, 1] : [.42, .68, 1];
    for (let i = 0; i < radii.length; i++) {
      const r = s.fieldR * radii[i] * (1 + pulse * .035);
      ringPath(s, r);
      ctx.strokeStyle = colorForEmitter(s, .10 + i * .045 + pulse * .10 + capture * .045);
      ctx.lineWidth = i === radii.length - 1 ? 2.2 : 1.25;
      ctx.stroke();
    }

    if (s.type === 'attract' && capture > .06) {
      ringPath(s, s.fieldR * (.54 - capture * .08));
      ctx.strokeStyle = `rgba(255,214,107,${.10 + capture * .32})`;
      ctx.lineWidth = 3 + capture * 3;
      ctx.stroke();
    }

    const glow = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, 80 + pulse * 30);
    glow.addColorStop(0, c); glow.addColorStop(.15, c); glow.addColorStop(.5, colorForEmitter(s, .18)); glow.addColorStop(1, colorForEmitter(s, 0));
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(s.x, s.y, 90 + pulse * 20, 0, Math.PI * 2); ctx.fill();

    ctx.strokeStyle = colorForEmitter(s, .9); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r + 13, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#f8fdff'; ctx.shadowBlur = 25; ctx.shadowColor = c;
    ctx.beginPath(); ctx.arc(s.x, s.y, 11 + pulse * 3, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;

    ctx.strokeStyle = colorForEmitter(s, .38); ctx.lineWidth = 2;
    const now = performance.now() * .001;
    for (let i = 0; i < 5; i++) {
      const a = now * (s.type === 'attract' ? .8 : -.6) + i * Math.PI * .4;
      const rr = s.fieldR * (.48 + .08 * Math.sin(now + i));
      const x = s.x + Math.cos(a) * rr, y = s.y + Math.sin(a) * rr;
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.stroke();
    }
  }

  function drawTrail() {
    const tr = state.ball.trail;
    for (let i = 1; i < tr.length; i++) {
      const a = i / tr.length;
      const charged = tr[i].speed > 1150;
      ctx.strokeStyle = charged ? `rgba(255,222,140,${a * .42})` : `rgba(220,244,255,${a * .20})`;
      ctx.lineWidth = 1 + a * (charged ? 8 : 4);
      ctx.beginPath(); ctx.moveTo(tr[i - 1].x, tr[i - 1].y); ctx.lineTo(tr[i].x, tr[i].y); ctx.stroke();
    }
  }

  function drawBall() {
    const b = state.ball, sp = speedOf(b), hot = clamp((sp - 800) / 750, 0, 1);
    const r = b.r + hot * 3;
    const glow = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, 55 + hot * 30);
    glow.addColorStop(0, '#fffdf1'); glow.addColorStop(.18, '#fff5c5'); glow.addColorStop(.42, `rgba(255,213,106,${.28 + hot * .35})`); glow.addColorStop(1, 'rgba(255,213,106,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(b.x, b.y, 70 + hot * 30, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fffdf4'; ctx.shadowBlur = 24 + hot * 18; ctx.shadowColor = '#ffd56a';
    ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
  }

  function drawParticles() {
    for (const p of state.particles) {
      const a = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = `rgba(${p.c[0]},${p.c[1]},${p.c[2]},${a})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * a, 0, Math.PI * 2); ctx.fill();
    }
  }

  function draw() {
    ctx.save();
    if (shake > .2) ctx.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake);
    drawBackground();
    drawEmitter(state.cpu);
    drawEmitter(state.player);
    drawTrail();
    drawBall();
    drawParticles();
    ctx.restore();
  }

  function loop(now) {
    const dt = Math.min(.05, (now - lastTime) / 1000);
    lastTime = now;
    accumulator += dt;
    const step = 1 / 120;
    let guard = 0;
    while (accumulator >= step && guard++ < 8) { update(step); accumulator -= step; }
    draw();
    requestAnimationFrame(loop);
  }

  function togglePause() {
    if (!running) return;
    paused = !paused;
    pauseBtn.textContent = paused ? '▶ RIPRENDI' : 'Ⅱ PAUSA';
    if (paused) feedback('PAUSA', '', 999999); else { actionFeedback.classList.remove('show'); feedbackTimer = 0; lastTime = performance.now(); }
  }

  canvas.addEventListener('pointerdown', e => {
    initAudio(); pointer.active = true; canvas.setPointerCapture(e.pointerId);
    const p = worldFromClient(e.clientX, e.clientY); pointer.x = p.x; pointer.y = p.y;
  });
  canvas.addEventListener('pointermove', e => {
    if (!pointer.active) return;
    const p = worldFromClient(e.clientX, e.clientY); pointer.x = p.x; pointer.y = p.y;
  });
  canvas.addEventListener('pointerup', e => { pointer.active = false; if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); });
  canvas.addEventListener('pointercancel', () => { pointer.active = false; });

  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' ', 'w', 'a', 's', 'd'].includes(k)) e.preventDefault();
    if (k === ' ' && !e.repeat) activatePulse(state.player, true);
    else if (k === 'escape' || k === 'p') togglePause();
    else keys.add(k);
  }, { passive: false });
  window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('resize', resize);

  pulseBtn.addEventListener('click', () => activatePulse(state.player, true));
  pauseBtn.addEventListener('click', togglePause);
  resetBtn.addEventListener('click', () => { if (running) newMatch(); else { menu.style.display = 'grid'; startBtn.textContent = 'PLAY — PRIMO A 7'; } });
  startBtn.addEventListener('click', newMatch);

  modeButtons.forEach(b => b.addEventListener('click', () => { selectedMode = b.dataset.mode; applySettings(); }));
  difficultyButtons.forEach(b => b.addEventListener('click', () => { selectedDifficulty = b.dataset.difficulty; applySettings(); }));
  polarityButtons.forEach(b => b.addEventListener('click', () => { selectedPolarity = b.dataset.polarity; applySettings(); }));

  applySettings(); updateHud(); resize(); resetPositions();
  requestAnimationFrame(loop);
})();
