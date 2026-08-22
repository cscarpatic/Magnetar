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
  const dashBtn = $('dashBtn');
  const dashState = $('dashState');
  const playerScoreEl = $('playerScore');
  const cpuScoreEl = $('cpuScore');
  const playerTypeLabel = $('playerTypeLabel');
  const cpuTypeLabel = $('cpuTypeLabel');
  const actionFeedback = $('actionFeedback');
  const actionTitle = $('actionTitle');
  const actionSub = $('actionSub');
  const matchPoint = $('matchPoint');
  const statusLine = $('statusLine');
  const roleMeter = $('roleMeter');
  const roleMeterFill = $('roleMeterFill');
  const roleMeterLabel = $('roleMeterLabel');
  const roleMeterText = $('roleMeterText');
  const rallyBadge = $('rallyBadge');

  const modeButtons = [...document.querySelectorAll('[data-mode]')];
  const difficultyButtons = [...document.querySelectorAll('[data-difficulty]')];
  const polarityWrap = $('polarityChoices');
  const polarityButtons = [...document.querySelectorAll('[data-polarity]')];

  const WORLD = { w: 1600, h: 900 };
  const FIELD_RADIUS = { attract: 475, repel: 350 };
  const PULSE_COOLDOWN = { attract: .72, repel: 1.72 };
  const PULSE_DURATION = .20;
  const DASH_COOLDOWN = 1.75;
  const DASH_DURATION = .12;
  const CAPTURE_MAX = 3.2;
  const CAPTURE_RELEASE_LOCK = .34;
  const REPULSOR_HEAT_LOCK = .96;
  const MAX_ORBIT_OMEGA = 13.5;
  const SUPERCHARGE_OMEGA = 9.0;
  const keys = new Set();
  const pointer = {
    active: false, x: 0, y: 0, lastTap: 0,
    orbitArmed: false, orbitLastAngle: 0, orbitLastT: 0, orbitLastEventT: 0
  };

  const MODES = {
    duel: { player: 'repel', cpu: 'repel' },
    orbit: { player: 'attract', cpu: 'attract' },
    polarity: { player: 'attract', cpu: 'repel' }
  };
  const DIFFICULTY = {
    rookie: { speed: 455, thinkMin: .22, thinkJitter: .15, aimError: 115, aggression: .07, pulseChance: .00, dashChance: .00 },
    rival: { speed: 545, thinkMin: .14, thinkJitter: .10, aimError: 58, aggression: .30, pulseChance: .045, dashChance: .025 },
    maniac: { speed: 625, thinkMin: .085, thinkJitter: .065, aimError: 27, aggression: .64, pulseChance: .095, dashChance: .06 }
  };

  let running = false, paused = false;
  let lastTime = performance.now(), accumulator = 0, resetTimer = 0;
  let selectedMode = 'duel', selectedPolarity = 'attract', selectedDifficulty = 'rival', polarityTurn = 'attract';
  let feedbackTimer = 0, hitStop = 0, shake = 0, audioCtx = null;

  const makeEmitter = (x, type, speed) => ({
    x, y: WORLD.h / 2, r: 42, type, maxSpeed: speed, fieldR: FIELD_RADIUS[type],
    pulse: 0, cooldown: 0, heat: 0, overheated: false,
    dashCooldown: 0, dashTime: 0, dashX: 0, dashY: 0,
    captureTime: 0, orbitAngle: 0, orbitSpin: 1, orbitRadius: FIELD_RADIUS.attract * .36,
    slingOmega: 0, slingPower: 0,
    think: 0, targetX: x, targetY: WORLD.h / 2
  });

  const state = {
    score: { player: 0, cpu: 0 },
    combo: 0, comboTimer: 0, rally: 0, rallyTimer: 0,
    lastOwner: null, lastFieldHitAt: 0, lastWallHit: 0,
    particles: [],
    ball: {
      x: WORLD.w / 2, y: WORLD.h / 2, vx: 0, vy: 0, r: 14, trail: [],
      capturedBy: null, chargedBy: null, chargedTime: 0, captureLock: 0
    },
    player: makeEmitter(WORLD.w * .84, 'repel', 735),
    cpu: makeEmitter(WORLD.w * .16, 'repel', 545)
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth01 = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const fadeOut = (t, start = .72) => 1 - smooth01((t - start) / (1 - start));
  const opposite = t => t === 'attract' ? 'repel' : 'attract';
  const speedOf = b => Math.hypot(b.vx, b.vy);
  const ownerDir = owner => owner === 'player' ? -1 : 1;
  const emitterOwner = emitter => emitter === state.player ? 'player' : 'cpu';
  const targetScore = () => selectedMode === 'polarity' ? 5 : 7;
  const normAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

  function initAudio() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (_) {}
  }
  function tone(freq, duration = .07, gain = .03, type = 'sine', glide = 1) {
    if (!audioCtx) return;
    const t = audioCtx.currentTime, o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * glide), t + duration);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(.0001, t + duration);
    o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + duration);
  }
  function sfx(kind, intensity = 1) {
    if (kind === 'pulse') { tone(150, .15, .05, 'sawtooth', 2.7); tone(410, .12, .025, 'sine', 1.7); }
    if (kind === 'sling') { tone(240, .11, .045, 'triangle', 2.8); tone(720, .16, .025, 'sine', 1.5); }
    if (kind === 'parry') { tone(190, .07, .05, 'square', 2.5); tone(830, .12, .025, 'triangle', 1.25); }
    if (kind === 'dash') tone(120, .08, .028, 'sawtooth', 2.2);
    if (kind === 'hit') tone(250 + 360 * intensity, .06, .018 + .022 * intensity, 'triangle', .76);
    if (kind === 'wall') tone(180 + 250 * intensity, .045, .018, 'square', .9);
    if (kind === 'point') { tone(430, .13, .045, 'triangle', 1.55); tone(710, .17, .028, 'sine', 1.3); }
    if (kind === 'lose') { tone(240, .15, .035, 'triangle', .72); tone(165, .19, .022, 'sine', .72); }
    if (kind === 'swap') { tone(290, .08, .025, 'triangle', 1.35); tone(410, .12, .02, 'sine', .78); }
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

  function setEmitterType(e, type) {
    e.type = type; e.fieldR = FIELD_RADIUS[type];
    e.captureTime = 0; e.slingOmega = 0; e.slingPower = 0; e.heat = 0; e.overheated = false;
  }
  function syncRoleLabels() {
    playerTypeLabel.textContent = state.player.type === 'attract' ? 'ATTRACTOR' : 'REPULSOR';
    cpuTypeLabel.textContent = state.cpu.type === 'attract' ? 'ATTRACTOR' : 'REPULSOR';
  }
  function setPolarityRoles(playerType, announce = false) {
    polarityTurn = playerType; setEmitterType(state.player, playerType); setEmitterType(state.cpu, opposite(playerType)); syncRoleLabels();
    if (announce && running) { feedback('POLI INVERTITI', playerType === 'attract' ? 'ORA CATTURA, RUOTA E RILASCIA' : 'ORA PARA E CONTRATTACCA', 900); sfx('swap'); }
  }
  function applySettings() {
    const m = MODES[selectedMode];
    if (selectedMode === 'polarity') setPolarityRoles(selectedPolarity, false);
    else { setEmitterType(state.player, m.player); setEmitterType(state.cpu, m.cpu); syncRoleLabels(); }
    state.cpu.maxSpeed = DIFFICULTY[selectedDifficulty].speed;
    modeButtons.forEach(b => b.classList.toggle('active', b.dataset.mode === selectedMode));
    difficultyButtons.forEach(b => b.classList.toggle('active', b.dataset.difficulty === selectedDifficulty));
    polarityButtons.forEach(b => b.classList.toggle('active', b.dataset.polarity === selectedPolarity));
    polarityWrap.hidden = selectedMode !== 'polarity';
    startBtn.textContent = `PLAY — PRIMO A ${targetScore()}`; updateHud();
  }

  function slingPower(e) { return clamp(Math.abs(e.slingOmega) / MAX_ORBIT_OMEGA, 0, 1); }
  function updateStatus() {
    if (!statusLine) return;
    if (state.player.type === 'attract') {
      statusLine.textContent = state.ball.capturedBy === state.player
        ? 'ATTRACTOR: fai ruotare il dito attorno al nucleo. Più veloce ruoti, più forte parte la palla quando rilasci.'
        : 'ATTRACTOR: intercetta la palla. Dopo il CATCH, ruota il dito attorno al nucleo e rilascia come una fionda.';
    } else if (selectedMode === 'polarity') {
      statusLine.textContent = 'REPULSOR: aspetta la palla vicino al nucleo per PERFECT PARRY. Dopo ogni punto i ruoli si scambiano.';
    } else statusLine.textContent = 'REPULSOR: difendi col posizionamento e usa PULSE per il parry. SHIFT = Dash.';
  }
  function updateHud() {
    playerScoreEl.textContent = state.score.player; cpuScoreEl.textContent = state.score.cpu;
    const cd = PULSE_COOLDOWN[state.player.type], ready = state.player.cooldown <= 0 && !(state.player.type === 'repel' && state.player.overheated);
    pulseBtn.classList.toggle('cooldown', !ready); pulseBtn.style.setProperty('--pulse-rotation', `${clamp(1 - state.player.cooldown / cd, 0, 1) * 360}deg`);
    if (state.player.type === 'attract' && state.ball.capturedBy === state.player) {
      const p = slingPower(state.player);
      pulseState.textContent = p >= SUPERCHARGE_OMEGA / MAX_ORBIT_OMEGA ? 'SUPERCHARGE' : 'RUOTA';
      pulseHint.textContent = 'RILASCIA IL DITO';
    } else if (state.player.type === 'repel' && state.player.overheated) { pulseState.textContent = 'HOT'; pulseHint.textContent = 'RAFFREDDA'; }
    else { pulseState.textContent = ready ? 'READY' : `${state.player.cooldown.toFixed(1)}s`; pulseHint.textContent = ready ? 'SPAZIO / TAP' : 'RICARICA'; }

    if (dashBtn) dashBtn.classList.toggle('cooldown', state.player.dashCooldown > 0);
    if (dashState) dashState.textContent = state.player.dashCooldown > 0 ? `${state.player.dashCooldown.toFixed(1)}s` : 'READY';
    if (roleMeter && roleMeterFill && roleMeterLabel && roleMeterText) {
      roleMeter.classList.toggle('heat', state.player.type === 'repel'); roleMeter.classList.toggle('capture', state.player.type === 'attract');
      if (state.player.type === 'repel') {
        roleMeterLabel.textContent = 'HEAT'; roleMeterText.textContent = state.player.overheated ? 'OVERHEAT' : `${Math.round(state.player.heat * 100)}%`; roleMeterFill.style.width = `${state.player.heat * 100}%`;
      } else {
        const p = state.ball.capturedBy === state.player ? slingPower(state.player) : 0;
        roleMeterLabel.textContent = 'SPIN';
        roleMeterText.textContent = state.ball.capturedBy === state.player ? (p >= SUPERCHARGE_OMEGA / MAX_ORBIT_OMEGA ? 'SUPERCHARGE' : `POWER ${Math.round(p * 100)}%`) : 'CATCH';
        roleMeterFill.style.width = `${p * 100}%`;
      }
    }
    if (rallyBadge) { rallyBadge.textContent = state.rally >= 2 ? `RALLY ×${state.rally}` : ''; rallyBadge.classList.toggle('show', state.rally >= 2); }
    matchPoint.classList.toggle('show', running && Math.max(state.score.player, state.score.cpu) === targetScore() - 1); updateStatus();
  }
  function feedback(title, sub = '', ms = 700) {
    actionTitle.textContent = title; actionSub.textContent = sub; actionFeedback.classList.add('show'); feedbackTimer = ms / 1000;
  }

  function resetPositions(serveToward = 0) {
    state.player.x = WORLD.w * .84; state.player.y = WORLD.h / 2; state.cpu.x = WORLD.w * .16; state.cpu.y = WORLD.h / 2;
    for (const e of [state.player, state.cpu]) {
      e.pulse = 0; e.captureTime = 0; e.slingOmega = 0; e.slingPower = 0; e.heat = 0; e.overheated = false; e.dashTime = 0;
    }
    state.player.cooldown = Math.min(state.player.cooldown, .35); state.cpu.cooldown = Math.min(state.cpu.cooldown, .55);
    state.combo = 0; state.comboTimer = 0; state.lastOwner = null; state.lastWallHit = 0; state.rally = 0; state.rallyTimer = 0;
    pointer.orbitArmed = false;
    const b = state.ball;
    b.capturedBy = null; b.chargedBy = null; b.chargedTime = 0; b.captureLock = 0; b.trail.length = 0;
    b.x = WORLD.w / 2; b.y = WORLD.h / 2 + (Math.random() - .5) * 150;
    const speed = 500, angle = (Math.random() - .5) * .52, sign = serveToward || (Math.random() < .5 ? -1 : 1);
    b.vx = Math.cos(angle) * speed * sign; b.vy = Math.sin(angle) * speed; resetTimer = .54;
  }
  function newMatch() {
    initAudio(); state.score.player = state.score.cpu = 0; state.player.cooldown = 0; state.cpu.cooldown = .55; state.player.dashCooldown = 0; state.cpu.dashCooldown = .8;
    paused = false; pauseBtn.textContent = 'Ⅱ PAUSA';
    if (selectedMode === 'polarity') setPolarityRoles(selectedPolarity, false); else applySettings();
    resetPositions(); updateHud(); running = true; menu.style.display = 'none'; lastTime = performance.now(); accumulator = 0;
    feedback(state.player.type === 'attract' ? 'CATCH → ROTATE → RELEASE' : 'WAIT → PARRY', state.player.type === 'attract' ? 'RUOTA IL DITO COME UNA FIONDA' : 'SHIFT = DASH', 1150);
  }
  function endMatch(who) {
    running = false; updateHud(); menu.style.display = 'grid'; $('menuTitle').textContent = who === 'player' ? 'Vittoria.' : 'Rivincita?';
    $('menuIntro').innerHTML = `Finale <b>${state.score.player} — ${state.score.cpu}</b>. ${who === 'player' ? 'Hai letto meglio il ritmo.' : 'Prova a cercare più timing e rotazione.'}`; startBtn.textContent = 'RIVINCITA';
  }
  function swapPolarityAfterPoint() {
    if (selectedMode !== 'polarity') return; setPolarityRoles(opposite(polarityTurn), false);
    setTimeout(() => { if (running) { feedback('POLI INVERTITI', state.player.type === 'attract' ? 'ORA CATTURA, RUOTA E RILASCIA' : 'ORA PARA E CONTRATTACCA', 820); sfx('swap'); } }, 360);
  }
  function scorePoint(who) {
    state.score[who]++; shake = who === 'player' ? 17 : 10; hitStop = .05;
    if (who === 'player') { feedback('PUNTO!', state.rally >= 3 ? `RALLY ×${state.rally}` : 'NICE SHOT', 820); sfx('point'); }
    else { feedback('PUNTO RIVALE', 'NUOVO RUOLO, NUOVA OCCASIONE', 720); sfx('lose'); }
    updateHud(); if (state.score[who] >= targetScore()) return setTimeout(() => endMatch(who), 430);
    swapPolarityAfterPoint(); resetPositions(who === 'player' ? -1 : 1);
  }

  function moveToward(body, tx, ty, speed, dt) {
    const dx = tx - body.x, dy = ty - body.y, d = Math.hypot(dx, dy); if (d < 1) return;
    const s = Math.min(d, speed * dt); body.x += dx / d * s; body.y += dy / d * s;
  }
  function enforceZones() {
    state.player.x = clamp(state.player.x, WORLD.w / 3 + state.player.r, WORLD.w - state.player.r);
    state.cpu.x = clamp(state.cpu.x, state.cpu.r, WORLD.w * 2 / 3 - state.cpu.r);
    for (const e of [state.player, state.cpu]) e.y = clamp(e.y, e.r, WORLD.h - e.r);
  }
  function inputVector() {
    let dx = 0, dy = 0;
    if (keys.has('arrowleft') || keys.has('a')) dx--; if (keys.has('arrowright') || keys.has('d')) dx++;
    if (keys.has('arrowup') || keys.has('w')) dy--; if (keys.has('arrowdown') || keys.has('s')) dy++;
    if (dx || dy) { const m = Math.hypot(dx, dy); return { x: dx / m, y: dy / m }; }
    if (pointer.active) { const dxp = pointer.x - state.player.x, dyp = pointer.y - state.player.y, m = Math.hypot(dxp, dyp) || 1; return { x: dxp / m, y: dyp / m }; }
    const b = state.ball, m = Math.hypot(b.x - state.player.x, b.y - state.player.y) || 1; return { x: (b.x - state.player.x) / m, y: (b.y - state.player.y) / m };
  }
  function activateDash(emitter, isPlayer = true, vec = null) {
    if (!running || paused || emitter.dashCooldown > 0 || state.ball.capturedBy === emitter) return false;
    if (!vec) {
      if (isPlayer) vec = inputVector();
      else { const b = state.ball, m = Math.hypot(b.x - emitter.x, b.y - emitter.y) || 1; vec = { x: (b.x - emitter.x) / m, y: (b.y - emitter.y) / m }; }
    }
    emitter.dashX = vec.x; emitter.dashY = vec.y; emitter.dashTime = DASH_DURATION; emitter.dashCooldown = DASH_COOLDOWN;
    burst(emitter.x, emitter.y, emitter === state.player ? 'cyan' : 'red', 12, 180);
    if (isPlayer) { feedback('DASH', 'RIPOSIZIONATI', 300); sfx('dash'); shake = Math.max(shake, 3); } return true;
  }
  function updatePlayer(dt) {
    if (state.player.dashTime > 0) { state.player.x += state.player.dashX * 1700 * dt; state.player.y += state.player.dashY * 1700 * dt; return; }
    if (state.ball.capturedBy === state.player && pointer.active) return;
    let tx = state.player.x, ty = state.player.y;
    if (pointer.active) { tx = pointer.x; ty = pointer.y; }
    else {
      const v = inputVector();
      if ([...keys].some(k => ['arrowleft','arrowright','arrowup','arrowdown','w','a','s','d'].includes(k))) { tx += v.x * state.player.maxSpeed * dt; ty += v.y * state.player.maxSpeed * dt; }
    }
    moveToward(state.player, tx, ty, state.player.maxSpeed, dt);
  }
  function reflectedY(y) { const span = WORLD.h * 2; y = ((y % span) + span) % span; return y > WORLD.h ? span - y : y; }
  function updateCpu(dt) {
    const c = state.cpu, b = state.ball, dcfg = DIFFICULTY[selectedDifficulty];
    if (c.dashTime > 0) { c.x += c.dashX * 1500 * dt; c.y += c.dashY * 1500 * dt; return; }
    if (b.capturedBy === c) return;
    c.think -= dt;
    if (c.think <= 0) {
      c.think = dcfg.thinkMin + Math.random() * dcfg.thinkJitter;
      const travel = clamp((c.x - b.x) / (Math.abs(b.vx) + 340), -.28, .52), py = reflectedY(b.y + b.vy * travel) + (Math.random() - .5) * dcfg.aimError;
      const danger = b.x < WORLD.w * .62 || b.vx < 0, home = WORLD.w * (.18 + .12 * dcfg.aggression);
      if (c.type === 'repel') { c.targetX = danger ? b.x - 165 : home; c.targetY = py; }
      else { c.targetX = danger ? b.x + 100 : home + 45; c.targetY = py + Math.sign(b.vy || 1) * (55 + 38 * dcfg.aggression); }
      c.targetX = clamp(c.targetX, 70, WORLD.w * 2 / 3 - 58); c.targetY = clamp(c.targetY, 65, WORLD.h - 65);
      const dist = Math.hypot(c.x - b.x, c.y - b.y);
      if (c.type === 'repel' && c.cooldown <= 0 && !c.overheated && dist < c.fieldR * .54 && Math.random() < dcfg.pulseChance * 2.1) activatePulse(c, false);
      if (c.dashCooldown <= 0 && danger && dist > c.fieldR * .9 && Math.random() < dcfg.dashChance) activateDash(c, false);
    }
    moveToward(c, c.targetX, c.targetY, c.maxSpeed, dt);
  }

  function dangerBoost(s) {
    const forward = s === state.player ? clamp((WORLD.w * .78 - s.x) / (WORLD.w * .45), 0, 1) : clamp((s.x - WORLD.w * .22) / (WORLD.w * .45), 0, 1);
    return 1 + .20 * smooth01(forward);
  }
  function armOrbitPointer(e, x, y) {
    pointer.orbitArmed = true; pointer.orbitLastAngle = Math.atan2(y - e.y, x - e.x);
    pointer.orbitLastT = pointer.orbitLastEventT = performance.now();
  }
  function rotateWithPointer(e, x, y) {
    if (state.ball.capturedBy !== e || !pointer.orbitArmed) return;
    const now = performance.now(), a = Math.atan2(y - e.y, x - e.x), delta = normAngle(a - pointer.orbitLastAngle);
    const dt = clamp((now - pointer.orbitLastT) / 1000, .008, .08), omega = clamp(delta / dt, -MAX_ORBIT_OMEGA, MAX_ORBIT_OMEGA);
    if (Math.abs(delta) > .002) {
      e.orbitAngle += delta;
      e.slingOmega = e.slingOmega * .58 + omega * .42;
      e.orbitSpin = Math.sign(e.slingOmega || e.orbitSpin || 1);
      e.slingPower = slingPower(e);
    }
    pointer.orbitLastAngle = a; pointer.orbitLastT = pointer.orbitLastEventT = now;
  }
  function enterCapture(emitter, owner) {
    const b = state.ball; if (b.capturedBy || b.captureLock > 0 || emitter.type !== 'attract') return false;
    const dx = b.x - emitter.x, dy = b.y - emitter.y, d = Math.hypot(dx, dy); if (d > emitter.fieldR * .58) return false;
    b.capturedBy = emitter; emitter.captureTime = 0; emitter.orbitAngle = Math.atan2(dy, dx); emitter.orbitRadius = emitter.fieldR * .36;
    const cross = b.vx * dy - b.vy * dx; emitter.orbitSpin = Math.sign(cross || (owner === 'player' ? -1 : 1));
    emitter.slingOmega = emitter.orbitSpin * 1.5; emitter.slingPower = slingPower(emitter); b.vx = b.vy = 0;
    if (owner === 'player') {
      if (pointer.active) armOrbitPointer(emitter, pointer.x, pointer.y); else pointer.orbitArmed = false;
      feedback('CATCH!', 'RUOTA IL DITO ATTORNO AL NUCLEO', 620); tone(360, .08, .022, 'sine', 1.6);
    }
    burst(b.x, b.y, owner === 'player' ? 'cyan' : 'red', 10, 130); registerRally(owner); return true;
  }
  function tangentFor(e) {
    const spin = Math.sign(e.slingOmega || e.orbitSpin || 1);
    return { x: -Math.sin(e.orbitAngle) * spin, y: Math.cos(e.orbitAngle) * spin, spin };
  }
  function releaseCapture(emitter, owner, forced = false, keyboard = false) {
    const b = state.ball; if (b.capturedBy !== emitter) return false;
    const tangent = tangentFor(emitter), power = slingPower(emitter);
    // La forza della fionda deriva dalla velocità angolare: più rapidamente ruoti il dito,
    // maggiore è la velocità tangenziale (omega × r) percepita al rilascio.
    let speed = 700 + 1180 * Math.pow(power, .72);
    if (keyboard) speed = Math.max(speed, 1220);
    if (forced) speed = Math.max(880, Math.min(speed, 1320));
    speed = clamp(speed, 680, 1900);
    const supercharged = !forced && power >= SUPERCHARGE_OMEGA / MAX_ORBIT_OMEGA;
    b.vx = tangent.x * speed; b.vy = tangent.y * speed;
    b.capturedBy = null; b.captureLock = CAPTURE_RELEASE_LOCK; b.chargedBy = owner; b.chargedTime = supercharged ? 1.35 : .85;
    emitter.captureTime = 0; emitter.cooldown = Math.max(emitter.cooldown, PULSE_COOLDOWN.attract); emitter.slingPower = 0;
    pointer.orbitArmed = false; registerRally(owner);
    if (owner === 'player') {
      feedback(supercharged ? 'ORBITAL SUPERCHARGE!' : forced ? 'AUTO RELEASE' : 'SLING RELEASE!', `${Math.round(speed)} SPEED · TANGENTE`, supercharged ? 850 : 650);
      sfx('sling'); shake = Math.max(shake, supercharged ? 12 : 7); hitStop = Math.max(hitStop, supercharged ? .035 : .018);
    }
    burst(b.x, b.y, owner === 'player' ? 'gold' : 'red', supercharged ? 28 : 16, supercharged ? 320 : 230); return true;
  }
  function repulsorParry(emitter, owner) {
    const b = state.ball, dx = b.x - emitter.x, dy = b.y - emitter.y, d = Math.hypot(dx, dy); if (d > emitter.fieldR * .72) return false;
    const dir = ownerDir(owner), incoming = owner === 'player' ? b.vx > 60 : b.vx < -60, perfect = d < emitter.fieldR * .36 && incoming && !emitter.overheated;
    const speed = perfect ? 1480 : 930, side = clamp(dy / (emitter.fieldR * .55), -1, 1), vy = clamp(b.vy * .30 + side * (perfect ? 330 : 210), -speed * .62, speed * .62);
    b.vx = dir * Math.sqrt(Math.max(1, speed * speed - vy * vy)); b.vy = vy;
    emitter.heat = clamp(emitter.heat + (perfect ? .28 : .42), 0, 1); if (emitter.heat >= REPULSOR_HEAT_LOCK) emitter.overheated = true;
    if (perfect) { b.chargedBy = owner; b.chargedTime = 1.15; }
    registerRally(owner);
    if (owner === 'player') { feedback(perfect ? 'PERFECT PARRY!' : 'PARRY', perfect ? 'CHARGE STEAL' : `HEAT ${Math.round(emitter.heat * 100)}%`, perfect ? 760 : 520); sfx(perfect ? 'parry' : 'hit', perfect ? 1 : .7); shake = Math.max(shake, perfect ? 11 : 5); hitStop = Math.max(hitStop, perfect ? .028 : .012); }
    burst(b.x, b.y, owner === 'player' ? (perfect ? 'gold' : 'cyan') : 'red', perfect ? 22 : 12, perfect ? 285 : 190); return true;
  }
  function activatePulse(emitter, isPlayer = true) {
    if (!running || paused || emitter.cooldown > 0) return;
    if (emitter.type === 'repel' && emitter.overheated) { if (isPlayer) feedback('OVERHEAT', 'ALLONTANATI E RAFFREDDA', 460); return; }
    initAudio(); const owner = emitterOwner(emitter); emitter.pulse = PULSE_DURATION;
    let action = false;
    if (emitter.type === 'attract') action = releaseCapture(emitter, owner, false, true);
    else { emitter.cooldown = PULSE_COOLDOWN.repel; action = repulsorParry(emitter, owner); }
    if (!action && emitter.type === 'repel') emitter.heat = clamp(emitter.heat + .18, 0, 1);
    if (isPlayer) { pulseBtn.classList.remove('firing'); void pulseBtn.offsetWidth; pulseBtn.classList.add('firing'); if (!action) feedback('PULSE!', emitter.type === 'attract' ? 'PRIMA CATTURA LA PALLA' : 'TROPPO PRESTO', 380); sfx('pulse'); shake = Math.max(shake, 4); }
    burst(emitter.x, emitter.y, isPlayer ? 'cyan' : 'red', 16, 210);
  }

  function wallWeights(s) {
    const r = s.fieldR; return { left: clamp(1 - s.x / r, 0, 1), right: clamp(1 - (WORLD.w - s.x) / r, 0, 1), top: clamp(1 - s.y / r, 0, 1), bottom: clamp(1 - (WORLD.h - s.y) / r, 0, 1) };
  }
  function bendAtWalls(s, b, fx, fy, w) {
    const original = Math.hypot(fx, fy); if (!original) return { fx: 0, fy: 0 }; const bend = .78;
    if (w.left && fx < 0) { const lost = -fx * w.left * bend; fx *= 1 - w.left * .66; fy += Math.sign(b.y - s.y || fy || 1) * lost; }
    if (w.right && fx > 0) { const lost = fx * w.right * bend; fx *= 1 - w.right * .66; fy += Math.sign(b.y - s.y || fy || 1) * lost; }
    if (w.top && fy < 0) { const lost = -fy * w.top * bend; fy *= 1 - w.top * .66; fx += Math.sign(b.x - s.x || fx || 1) * lost; }
    if (w.bottom && fy > 0) { const lost = fy * w.bottom * bend; fy *= 1 - w.bottom * .66; fx += Math.sign(b.x - s.x || fx || 1) * lost; }
    const m = Math.hypot(fx, fy) || 1; return { fx: fx / m * original * .985, fy: fy / m * original * .985 };
  }
  function registerRally(owner) { if (state.lastOwner !== owner) { state.rally++; state.rallyTimer = 2.2; state.lastOwner = owner; } }
  function registerFieldHit(owner) {
    const now = performance.now() / 1000, b = state.ball, speed = speedOf(b);
    if (now - state.lastFieldHitAt > .28) {
      state.lastFieldHitAt = now; registerRally(owner);
      if (owner === 'player') {
        state.combo = state.comboTimer > 0 ? state.combo + 1 : 1; state.comboTimer = 1.6;
        if (state.lastWallHit > 0 && speed > 900) feedback(`WALL SHOT ×${Math.max(2, state.combo)}`, 'KEEP IT MOVING', 560);
        else if (speed > 1280) feedback('SUPERCHARGED', `${Math.round(speed)} SPEED`, 460);
        sfx('hit', clamp(speed / 1500, .2, 1));
      }
    }
  }
  function fieldForce(s, b, owner, dt) {
    if (b.capturedBy) return { ax: 0, ay: 0 };
    const dx = s.x - b.x, dy = s.y - b.y, d = Math.hypot(dx, dy); if (d < .01) return { ax: 0, ay: 0 };
    const w = wallWeights(s), sx = 1 + .9 * (w.left + w.right), sy = 1 + .9 * (w.top + w.bottom);
    if (Math.hypot(dx * sx, dy * sy) >= s.fieldR) return { ax: 0, ay: 0 };
    if (s.type === 'attract' && enterCapture(s, owner)) return { ax: 0, ay: 0 };
    const tx = dx / d, ty = dy / d, t = clamp(d / s.fieldR, 0, 1), zone = dangerBoost(s); let fx = 0, fy = 0;
    if (s.type === 'repel') {
      const efficiency = 1 - .58 * smooth01(s.heat), pulseBoost = s.pulse > 0 ? 1.18 : 1;
      const strength = 1540 * Math.pow(1 - t, .70) * fadeOut(t, .70) * efficiency * pulseBoost * zone;
      fx = -tx * strength; fy = -ty * strength; s.heat = clamp(s.heat + dt * (.23 + .24 * (1 - t)), 0, 1); if (s.heat >= REPULSOR_HEAT_LOCK) s.overheated = true;
    } else {
      const radial = 1900 * Math.exp(-.5 * Math.pow((t - .67) / .20, 2)) * fadeOut(t, .95) * zone;
      fx = tx * radial; fy = ty * radial;
      const tangentX = -ty, tangentY = tx, spin = Math.sign(b.vx * tangentX + b.vy * tangentY || 1);
      const tangential = 2250 * Math.exp(-.5 * Math.pow((t - .54) / .28, 2)) * fadeOut(t, .96) * zone;
      fx += tangentX * spin * tangential; fy += tangentY * spin * tangential;
      const dangerVel = owner === 'player' ? Math.max(0, b.vx) : Math.max(0, -b.vx); fx += ownerDir(owner) * dangerVel * 3.4 * fadeOut(t, .93);
    }
    registerFieldHit(owner); const bent = bendAtWalls(s, b, fx, fy, w); return { ax: bent.fx, ay: bent.fy };
  }

  function updateCapturedBall(dt) {
    const b = state.ball, e = b.capturedBy; if (!e) return false;
    e.captureTime += dt;
    const owner = emitterOwner(e);
    if (owner === 'player') {
      const sinceMove = (performance.now() - pointer.orbitLastEventT) / 1000;
      if (!pointer.orbitArmed || sinceMove > .09) e.slingOmega *= Math.pow(.11, dt);
      e.slingPower = slingPower(e);
      if (!pointer.orbitArmed) e.orbitAngle += e.slingOmega * dt * .55;
      else e.orbitAngle += e.slingOmega * dt * .16;
      e.orbitRadius = e.fieldR * (.345 + .055 * e.slingPower);
    } else {
      const dir = ownerDir(owner);
      const targetOmega = 4.5 + 3.8 * DIFFICULTY[selectedDifficulty].aggression;
      e.slingOmega = e.orbitSpin * targetOmega; e.slingPower = slingPower(e); e.orbitAngle += e.slingOmega * dt; e.orbitRadius = e.fieldR * (.35 + .035 * e.slingPower);
      const tan = tangentFor(e);
      if ((tan.x * dir > .83 && e.captureTime > .32) || e.captureTime > 1.15) releaseCapture(e, owner, false, false);
      if (!b.capturedBy) return true;
    }
    b.x = e.x + Math.cos(e.orbitAngle) * e.orbitRadius; b.y = e.y + Math.sin(e.orbitAngle) * e.orbitRadius; b.vx = b.vy = 0;
    b.trail.push({ x: b.x, y: b.y, speed: 650 + e.slingPower * 1050 }); if (b.trail.length > 48) b.trail.shift();
    if (e.captureTime >= CAPTURE_MAX) releaseCapture(e, owner, true, false); return true;
  }
  function updateBall(dt) {
    if (resetTimer > 0) { resetTimer -= dt; return; }
    const b = state.ball; if (updateCapturedBall(dt)) return;
    const fp = fieldForce(state.player, b, 'player', dt), fc = fieldForce(state.cpu, b, 'cpu', dt);
    b.vx += (fp.ax + fc.ax) * dt; b.vy += (fp.ay + fc.ay) * dt;
    let sp = speedOf(b); const maxSpeed = 1980; if (sp > maxSpeed) { b.vx = b.vx / sp * maxSpeed; b.vy = b.vy / sp * maxSpeed; sp = maxSpeed; }
    b.x += b.vx * dt; b.y += b.vy * dt;
    let wall = false;
    if (b.y - b.r <= 0 && b.vy < 0) { b.y = b.r; b.vy = Math.abs(b.vy) * .99; wall = true; }
    else if (b.y + b.r >= WORLD.h && b.vy > 0) { b.y = WORLD.h - b.r; b.vy = -Math.abs(b.vy) * .99; wall = true; }
    if (wall) { state.lastWallHit = .9; sfx('wall', clamp(sp / 1500, .15, 1)); burst(b.x, b.y, 'gold', sp > 1050 ? 10 : 5, 110 + sp * .055); }
    if (b.x + b.r < 0) scorePoint('player'); else if (b.x - b.r > WORLD.w) scorePoint('cpu');
    if (running) { b.trail.push({ x: b.x, y: b.y, speed: speedOf(b) }); if (b.trail.length > (speedOf(b) > 1200 ? 48 : 32)) b.trail.shift(); }
  }

  function burst(x, y, color, count = 10, power = 180) {
    const palette = { cyan: [93,231,255], red: [255,88,116], gold: [255,214,107] }, c = palette[color] || palette.cyan;
    for (let i = 0; i < count; i++) { const a = Math.random() * Math.PI * 2, sp = power * (.35 + Math.random() * .75); state.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: .25 + Math.random() * .38, max: .63, c, r: 1.2 + Math.random() * 2.5 }); }
  }
  function updateParticles(dt) { for (const p of state.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .984; p.vy *= .984; p.life -= dt; } state.particles = state.particles.filter(p => p.life > 0).slice(-230); }
  function updateEmitterMeters(e, dt) {
    e.cooldown = Math.max(0, e.cooldown - dt); e.pulse = Math.max(0, e.pulse - dt); e.dashCooldown = Math.max(0, e.dashCooldown - dt); e.dashTime = Math.max(0, e.dashTime - dt);
    if (e.type === 'repel') { const ballNear = !state.ball.capturedBy && Math.hypot(state.ball.x - e.x, state.ball.y - e.y) < e.fieldR; if (!ballNear) e.heat = Math.max(0, e.heat - dt * .34); if (e.overheated && e.heat < .48) e.overheated = false; }
  }
  function update(dt) {
    if (!running || paused) return; if (hitStop > 0) { hitStop -= dt; updateParticles(dt * .3); return; }
    updateEmitterMeters(state.player, dt); updateEmitterMeters(state.cpu, dt);
    state.comboTimer = Math.max(0, state.comboTimer - dt); state.rallyTimer = Math.max(0, state.rallyTimer - dt); state.lastWallHit = Math.max(0, state.lastWallHit - dt);
    state.ball.chargedTime = Math.max(0, state.ball.chargedTime - dt); state.ball.captureLock = Math.max(0, state.ball.captureLock - dt); if (!state.ball.chargedTime) state.ball.chargedBy = null;
    if (!state.comboTimer) state.combo = 0; if (!state.rallyTimer && state.rally < 2) state.rally = 0;
    if (feedbackTimer > 0) { feedbackTimer -= dt; if (feedbackTimer <= 0) actionFeedback.classList.remove('show'); }
    shake *= Math.pow(.035, dt); updatePlayer(dt); updateCpu(dt); enforceZones(); updateBall(dt); updateParticles(dt); updateHud();
  }

  function colorForEmitter(s, alpha = 1) { const c = s === state.player ? [93,231,255] : [255,88,116]; return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`; }
  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, WORLD.w, WORLD.h); g.addColorStop(0, '#040814'); g.addColorStop(.5, '#050a17'); g.addColorStop(1, '#070713'); ctx.fillStyle = g; ctx.fillRect(0, 0, WORLD.w, WORLD.h);
    const blue = ctx.createRadialGradient(WORLD.w * .76, WORLD.h * .38, 20, WORLD.w * .76, WORLD.h * .38, 580); blue.addColorStop(0, 'rgba(30,118,190,.08)'); blue.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = blue; ctx.fillRect(0,0,WORLD.w,WORLD.h);
    const red = ctx.createRadialGradient(WORLD.w * .18, WORLD.h * .58, 20, WORLD.w * .18, WORLD.h * .58, 560); red.addColorStop(0, 'rgba(150,28,52,.055)'); red.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = red; ctx.fillRect(0,0,WORLD.w,WORLD.h);
    ctx.fillStyle = 'rgba(255,255,255,.20)'; for (let i = 0; i < 58; i++) { const x = (i * 347 + 83) % WORLD.w, y = (i * 173 + 97) % WORLD.h; ctx.globalAlpha = .12 + (i % 5) * .045; ctx.fillRect(x, y, i % 7 === 0 ? 2 : 1, i % 7 === 0 ? 2 : 1); } ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,.035)'; ctx.beginPath(); ctx.moveTo(WORLD.w/2,55); ctx.lineTo(WORLD.w/2,WORLD.h-55); ctx.stroke();
    const dz = ctx.createLinearGradient(WORLD.w/3,0,WORLD.w*2/3,0); dz.addColorStop(0,'rgba(255,214,107,0)'); dz.addColorStop(.5,'rgba(255,214,107,.045)'); dz.addColorStop(1,'rgba(255,214,107,0)'); ctx.fillStyle=dz; ctx.fillRect(WORLD.w/3,0,WORLD.w/3,WORLD.h);
    ctx.fillStyle='rgba(255,214,107,.12)'; ctx.font='700 12px system-ui'; ctx.textAlign='center'; ctx.fillText(selectedMode==='polarity'?'HIGH RISK ZONE · +20% FIELD':'DANGER ZONE · +20% FIELD',WORLD.w/2,31);
  }
  function deformRingPoint(s,r,a) {
    let x=s.x+Math.cos(a)*r,y=s.y+Math.sin(a)*r; const slide=.64,m=10;
    if(x<m){const o=m-x;x=m;y+=Math.sign(y-s.y||1)*o*slide} if(x>WORLD.w-m){const o=x-(WORLD.w-m);x=WORLD.w-m;y+=Math.sign(y-s.y||1)*o*slide}
    if(y<m){const o=m-y;y=m;x+=Math.sign(x-s.x||1)*o*slide} if(y>WORLD.h-m){const o=y-(WORLD.h-m);y=WORLD.h-m;x+=Math.sign(x-s.x||1)*o*slide}
    return{x:clamp(x,m,WORLD.w-m),y:clamp(y,m,WORLD.h-m)};
  }
  function ringPath(s,r){ctx.beginPath();for(let i=0;i<=96;i++){const p=deformRingPoint(s,r,i/96*Math.PI*2);if(!i)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y)}}
  function drawSlingGuide(s) {
    if (s.type !== 'attract' || state.ball.capturedBy !== s) return;
    const b=state.ball,p=slingPower(s),tan=tangentFor(s),supercharged=p>=SUPERCHARGE_OMEGA/MAX_ORBIT_OMEGA;
    ctx.strokeStyle=supercharged?'rgba(255,214,107,.95)':colorForEmitter(s,.62); ctx.lineWidth=2.5+p*4; ctx.setLineDash([10,8]); ctx.beginPath(); ctx.moveTo(s.x,s.y); ctx.lineTo(b.x,b.y); ctx.stroke(); ctx.setLineDash([]);
    const len=70+p*145; ctx.strokeStyle=supercharged?'rgba(255,225,130,.98)':'rgba(230,248,255,.72)'; ctx.lineWidth=4+p*3; ctx.beginPath(); ctx.moveTo(b.x,b.y); ctx.lineTo(b.x+tan.x*len,b.y+tan.y*len); ctx.stroke();
    const ex=b.x+tan.x*len,ey=b.y+tan.y*len,a=Math.atan2(tan.y,tan.x); ctx.fillStyle=ctx.strokeStyle; ctx.beginPath(); ctx.moveTo(ex,ey); ctx.lineTo(ex-Math.cos(a-.45)*18,ey-Math.sin(a-.45)*18); ctx.lineTo(ex-Math.cos(a+.45)*18,ey-Math.sin(a+.45)*18); ctx.closePath(); ctx.fill();
  }
  function drawEmitter(s) {
    const pulse=s.pulse>0?1:0,c=colorForEmitter(s,1),radii=s.type==='attract'?[.34,.55,.76,1]:[.42,.68,1];
    for(let i=0;i<radii.length;i++){ringPath(s,s.fieldR*radii[i]*(1+pulse*.03));const heatFade=s.type==='repel'?1-.45*s.heat:1;ctx.strokeStyle=colorForEmitter(s,(.10+i*.045+pulse*.08)*heatFade);ctx.lineWidth=i===radii.length-1?2.2:1.25;ctx.stroke()}
    if(s.type==='repel'&&s.heat>.08){ringPath(s,s.fieldR*.52);ctx.strokeStyle=`rgba(255,214,107,${.08+s.heat*.34})`;ctx.lineWidth=2+s.heat*4;ctx.stroke()}
    if(s.type==='attract'&&state.ball.capturedBy===s){const p=slingPower(s);ringPath(s,s.orbitRadius);ctx.strokeStyle=p>=SUPERCHARGE_OMEGA/MAX_ORBIT_OMEGA?'rgba(255,214,107,.96)':`rgba(255,214,107,${.25+p*.48})`;ctx.lineWidth=3+p*5;ctx.stroke();drawSlingGuide(s)}
    const glow=ctx.createRadialGradient(s.x,s.y,0,s.x,s.y,80+pulse*25);glow.addColorStop(0,c);glow.addColorStop(.15,c);glow.addColorStop(.5,colorForEmitter(s,.18));glow.addColorStop(1,colorForEmitter(s,0));ctx.fillStyle=glow;ctx.beginPath();ctx.arc(s.x,s.y,90+pulse*18,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle=colorForEmitter(s,.9);ctx.lineWidth=3;ctx.beginPath();ctx.arc(s.x,s.y,s.r+13,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#f8fdff';ctx.shadowBlur=25;ctx.shadowColor=c;ctx.beginPath();ctx.arc(s.x,s.y,11+pulse*3,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
  }
  function drawTrail(){const tr=state.ball.trail;for(let i=1;i<tr.length;i++){const a=i/tr.length,charged=tr[i].speed>1150||state.ball.chargedTime>0;let col=charged?`rgba(255,222,140,${a*.42})`:`rgba(220,244,255,${a*.20})`;if(state.ball.chargedBy==='player')col=`rgba(93,231,255,${a*.45})`;else if(state.ball.chargedBy==='cpu')col=`rgba(255,88,116,${a*.42})`;ctx.strokeStyle=col;ctx.lineWidth=1+a*(charged?8:4);ctx.beginPath();ctx.moveTo(tr[i-1].x,tr[i-1].y);ctx.lineTo(tr[i].x,tr[i].y);ctx.stroke()}}
  function drawBall(){const b=state.ball,sp=speedOf(b),hot=clamp((sp-800)/750,0,1),r=b.r+hot*3;let core='#fffdf4',glowColor='255,213,106';if(b.capturedBy===state.player||b.chargedBy==='player'){core='#ecfdff';glowColor='93,231,255'}else if(b.capturedBy===state.cpu||b.chargedBy==='cpu'){core='#fff1f4';glowColor='255,88,116'}const g=ctx.createRadialGradient(b.x,b.y,0,b.x,b.y,55+hot*30);g.addColorStop(0,core);g.addColorStop(.18,core);g.addColorStop(.42,`rgba(${glowColor},${.28+hot*.35})`);g.addColorStop(1,`rgba(${glowColor},0)`);ctx.fillStyle=g;ctx.beginPath();ctx.arc(b.x,b.y,70+hot*30,0,Math.PI*2);ctx.fill();ctx.fillStyle=core;ctx.shadowBlur=24+hot*18;ctx.shadowColor=`rgb(${glowColor})`;ctx.beginPath();ctx.arc(b.x,b.y,r,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0}
  function drawParticles(){for(const p of state.particles){const a=clamp(p.life/p.max,0,1);ctx.fillStyle=`rgba(${p.c[0]},${p.c[1]},${p.c[2]},${a})`;ctx.beginPath();ctx.arc(p.x,p.y,p.r*a,0,Math.PI*2);ctx.fill()}}
  function draw(){ctx.save();if(shake>.2)ctx.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake);drawBackground();drawEmitter(state.cpu);drawEmitter(state.player);drawTrail();drawBall();drawParticles();ctx.restore()}
  function loop(now){const dt=Math.min(.05,(now-lastTime)/1000);lastTime=now;accumulator+=dt;const step=1/120;let guard=0;while(accumulator>=step&&guard++<8){update(step);accumulator-=step}draw();requestAnimationFrame(loop)}

  function togglePause(){if(!running)return;paused=!paused;pauseBtn.textContent=paused?'▶ RIPRENDI':'Ⅱ PAUSA';if(paused)feedback('PAUSA','',999999);else{actionFeedback.classList.remove('show');feedbackTimer=0;lastTime=performance.now()}}

  canvas.addEventListener('pointerdown',e=>{
    initAudio();const p=worldFromClient(e.clientX,e.clientY);pointer.x=p.x;pointer.y=p.y;pointer.active=true;const captured=state.player.type==='attract'&&state.ball.capturedBy===state.player;const now=performance.now();
    if(captured)armOrbitPointer(state.player,p.x,p.y);else{if(now-pointer.lastTap<285)activateDash(state.player,true);pointer.lastTap=now;pointer.orbitArmed=false}canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove',e=>{if(!pointer.active)return;const p=worldFromClient(e.clientX,e.clientY);pointer.x=p.x;pointer.y=p.y;if(state.ball.capturedBy===state.player){if(!pointer.orbitArmed)armOrbitPointer(state.player,p.x,p.y);else rotateWithPointer(state.player,p.x,p.y)}});
  canvas.addEventListener('pointerup',e=>{
    if(pointer.active&&pointer.orbitArmed&&state.ball.capturedBy===state.player&&state.player.type==='attract')releaseCapture(state.player,'player',false,false);
    pointer.active=false;pointer.orbitArmed=false;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointercancel',()=>{pointer.active=false;pointer.orbitArmed=false});

  window.addEventListener('keydown',e=>{const k=e.key.toLowerCase();if(['arrowleft','arrowright','arrowup','arrowdown',' ','shift','w','a','s','d'].includes(k))e.preventDefault();if(k===' '&&!e.repeat)activatePulse(state.player,true);else if(k==='shift'&&!e.repeat)activateDash(state.player,true);else if(k==='escape'||k==='p')togglePause();else keys.add(k)},{passive:false});
  window.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));window.addEventListener('blur',()=>keys.clear());window.addEventListener('resize',resize);
  pulseBtn.addEventListener('click',()=>activatePulse(state.player,true));if(dashBtn)dashBtn.addEventListener('click',()=>activateDash(state.player,true));pauseBtn.addEventListener('click',togglePause);
  resetBtn.addEventListener('click',()=>{if(running)newMatch();else{menu.style.display='grid';startBtn.textContent=`PLAY — PRIMO A ${targetScore()}`}});startBtn.addEventListener('click',newMatch);
  modeButtons.forEach(b=>b.addEventListener('click',()=>{selectedMode=b.dataset.mode;applySettings()}));difficultyButtons.forEach(b=>b.addEventListener('click',()=>{selectedDifficulty=b.dataset.difficulty;applySettings()}));polarityButtons.forEach(b=>b.addEventListener('click',()=>{selectedPolarity=b.dataset.polarity;applySettings()}));

  applySettings();updateHud();resize();resetPositions();requestAnimationFrame(loop);
})();
