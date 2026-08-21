(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const frame = document.getElementById('frame');
  const menu = document.getElementById('menu');
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resetBtn = document.getElementById('resetBtn');
  const toast = document.getElementById('toast');
  const choiceButtons = [...document.querySelectorAll('.choice')];

  const WORLD = { w: 1600, h: 900 };
  const TARGET_SCORE = 7;
  const keys = new Set();
  const pointer = { active: false, x: 0, y: 0 };

  let dpr = 1;
  let running = false;
  let paused = false;
  let lastTime = performance.now();
  let accumulator = 0;
  let selectedType = 'attract';
  let resetTimer = 0;

  const state = {
    score: { player: 0, cpu: 0 },
    ball: { x: WORLD.w / 2, y: WORLD.h / 2, vx: 0, vy: 0, r: 12, trail: [] },
    player: { x: WORLD.w * .84, y: WORLD.h / 2, r: 45, type: 'attract', maxSpeed: 720 },
    cpu: { x: WORLD.w * .16, y: WORLD.h / 2, r: 45, type: 'repel', maxSpeed: 570, think: 0, targetY: WORLD.h/2, targetX: WORLD.w*.16 },
  };

  function opposite(type) { return type === 'attract' ? 'repel' : 'attract'; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function resize() {
    const rect = frame.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(canvas.width / WORLD.w, 0, 0, canvas.height / WORLD.h, 0, 0);
  }

  function worldFromClient(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / rect.width * WORLD.w,
      y: (clientY - rect.top) / rect.height * WORLD.h,
    };
  }

  function setPlayerType(type) {
    selectedType = type;
    state.player.type = type;
    state.cpu.type = opposite(type);
    choiceButtons.forEach(b => b.classList.toggle('active', b.dataset.type === type));
  }

  function resetPositions(serveToward = 0) {
    state.player.x = WORLD.w * .84;
    state.player.y = WORLD.h / 2;
    state.cpu.x = WORLD.w * .16;
    state.cpu.y = WORLD.h / 2;
    state.ball.x = WORLD.w / 2;
    state.ball.y = WORLD.h / 2 + (Math.random() - .5) * 160;
    const speed = 470;
    const angle = (Math.random() - .5) * .65;
    const sign = serveToward || (Math.random() < .5 ? -1 : 1);
    state.ball.vx = Math.cos(angle) * speed * sign;
    state.ball.vy = Math.sin(angle) * speed;
    state.ball.trail.length = 0;
    resetTimer = .75;
  }

  function newMatch() {
    state.score.player = 0;
    state.score.cpu = 0;
    paused = false;
    pauseBtn.textContent = 'Pausa';
    state.player.type = selectedType;
    state.cpu.type = opposite(selectedType);
    resetPositions();
    running = true;
    menu.style.display = 'none';
    lastTime = performance.now();
    accumulator = 0;
  }

  function showToast(text, ms = 700) {
    toast.textContent = text;
    toast.classList.add('show');
    window.clearTimeout(showToast.t);
    showToast.t = window.setTimeout(() => toast.classList.remove('show'), ms);
  }

  function endMatch(who) {
    running = false;
    menu.style.display = 'grid';
    const card = menu.querySelector('.card');
    card.querySelector('h2').textContent = who === 'player' ? 'Hai vinto.' : 'Il computer ha vinto.';
    card.querySelector('p').textContent = `Finale ${state.score.player} — ${state.score.cpu}. Cambia polarità o gioca la rivincita.`;
    startBtn.textContent = 'RIVINCITA';
  }

  function scorePoint(who) {
    state.score[who] += 1;
    showToast(who === 'player' ? 'PUNTO TU' : 'PUNTO CPU', 800);
    if (state.score[who] >= TARGET_SCORE) {
      endMatch(who);
      return;
    }
    resetPositions(who === 'player' ? -1 : 1);
  }

  function moveToward(body, tx, ty, speed, dt) {
    const dx = tx - body.x;
    const dy = ty - body.y;
    const d = Math.hypot(dx,dy);
    if (d < 1) return;
    const step = Math.min(d, speed * dt);
    body.x += dx / d * step;
    body.y += dy / d * step;
  }

  function enforceZones() {
    state.player.x = clamp(state.player.x, WORLD.w / 3 + state.player.r, WORLD.w - state.player.r);
    state.cpu.x = clamp(state.cpu.x, state.cpu.r, WORLD.w * 2 / 3 - state.cpu.r);
    state.player.y = clamp(state.player.y, state.player.r, WORLD.h - state.player.r);
    state.cpu.y = clamp(state.cpu.y, state.cpu.r, WORLD.h - state.cpu.r);

    const dx = state.player.x - state.cpu.x;
    const dy = state.player.y - state.cpu.y;
    const d = Math.hypot(dx, dy);
    const minD = state.player.r + state.cpu.r + 10;
    if (d > 0 && d < minD) {
      const push = (minD - d) * .5;
      const nx = dx / d, ny = dy / d;
      state.player.x += nx * push;
      state.player.y += ny * push;
      state.cpu.x -= nx * push;
      state.cpu.y -= ny * push;
    }
  }

  function updatePlayer(dt) {
    let tx = state.player.x;
    let ty = state.player.y;

    if (pointer.active) {
      tx = pointer.x;
      ty = pointer.y;
    } else {
      let dx = 0, dy = 0;
      if (keys.has('arrowleft') || keys.has('a')) dx -= 1;
      if (keys.has('arrowright') || keys.has('d')) dx += 1;
      if (keys.has('arrowup') || keys.has('w')) dy -= 1;
      if (keys.has('arrowdown') || keys.has('s')) dy += 1;
      if (dx || dy) {
        const m = Math.hypot(dx,dy);
        tx += dx / m * state.player.maxSpeed * dt;
        ty += dy / m * state.player.maxSpeed * dt;
      }
    }
    moveToward(state.player, tx, ty, state.player.maxSpeed, dt);
  }

  function updateCpu(dt) {
    const cpu = state.cpu;
    cpu.think -= dt;
    if (cpu.think <= 0) {
      cpu.think = .11 + Math.random() * .09;
      const b = state.ball;
      const lead = clamp((cpu.x - b.x) / (Math.abs(b.vx) + 280), -.35, .55);
      let predictedY = b.y + b.vy * lead;
      const span = WORLD.h * 2;
      predictedY = ((predictedY % span) + span) % span;
      if (predictedY > WORLD.h) predictedY = span - predictedY;

      const danger = b.x < WORLD.w * .55 || b.vx < 0;
      const homeX = WORLD.w * .14;
      let desiredX = danger ? clamp(b.x - 150, WORLD.w*.08, WORLD.w*.48) : homeX;

      if (cpu.type === 'repel') {
        desiredX = Math.min(desiredX, b.x - 90);
        cpu.targetY = predictedY;
      } else {
        cpu.targetY = clamp(predictedY + Math.sign(b.vy || 1) * 80, 80, WORLD.h - 80);
      }
      cpu.targetX = desiredX;
    }
    moveToward(cpu, cpu.targetX, cpu.targetY, cpu.maxSpeed, dt);
  }

  function gravityFrom(source, ball) {
    const dx = source.x - ball.x;
    const dy = source.y - ball.y;
    const d2 = dx*dx + dy*dy;
    const soft = 95 * 95;
    const invD = 1 / Math.sqrt(d2 + soft);
    const strength = 34_000_000;
    let a = strength / (d2 + soft);
    a = Math.min(a, 2700);
    const sign = source.type === 'attract' ? 1 : -1;
    return { ax: dx * invD * a * sign, ay: dy * invD * a * sign };
  }

  function updateBall(dt) {
    if (resetTimer > 0) {
      resetTimer -= dt;
      return;
    }

    const b = state.ball;
    const gp = gravityFrom(state.player, b);
    const gc = gravityFrom(state.cpu, b);
    b.vx += (gp.ax + gc.ax) * dt;
    b.vy += (gp.ay + gc.ay) * dt;

    const speed = Math.hypot(b.vx, b.vy);
    const maxSpeed = 1500;
    if (speed > maxSpeed) {
      b.vx = b.vx / speed * maxSpeed;
      b.vy = b.vy / speed * maxSpeed;
    }

    b.x += b.vx * dt;
    b.y += b.vy * dt;

    if (b.y - b.r <= 0 && b.vy < 0) {
      b.y = b.r;
      b.vy = Math.abs(b.vy) * .985;
    } else if (b.y + b.r >= WORLD.h && b.vy > 0) {
      b.y = WORLD.h - b.r;
      b.vy = -Math.abs(b.vy) * .985;
    }

    if (b.x + b.r < 0) scorePoint('player');
    else if (b.x - b.r > WORLD.w) scorePoint('cpu');

    if (running) {
      b.trail.push({x:b.x, y:b.y});
      if (b.trail.length > 22) b.trail.shift();
    }
  }

  function step(dt) {
    if (!running || paused) return;
    updatePlayer(dt);
    updateCpu(dt);
    enforceZones();
    updateBall(dt);
  }

  function drawField() {
    ctx.clearRect(0,0,WORLD.w,WORLD.h);
    const grad = ctx.createLinearGradient(0,0,WORLD.w,WORLD.h);
    grad.addColorStop(0, '#07101e');
    grad.addColorStop(.5, '#080b18');
    grad.addColorStop(1, '#130812');
    ctx.fillStyle = grad;
    ctx.fillRect(0,0,WORLD.w,WORLD.h);

    ctx.fillStyle = 'rgba(255,255,255,.22)';
    for (let i = 0; i < 46; i++) {
      const x = (i * 347) % WORLD.w;
      const y = (i * 173 + 91) % WORLD.h;
      ctx.fillRect(x, y, 2, 2);
    }

    ctx.fillStyle = 'rgba(255,107,125,.035)';
    ctx.fillRect(0,0,WORLD.w*2/3,WORLD.h);
    ctx.fillStyle = 'rgba(100,230,255,.035)';
    ctx.fillRect(WORLD.w/3,0,WORLD.w*2/3,WORLD.h);

    ctx.setLineDash([12, 16]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,.12)';
    ctx.beginPath(); ctx.moveTo(WORLD.w/3,0); ctx.lineTo(WORLD.w/3,WORLD.h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(WORLD.w*2/3,0); ctx.lineTo(WORLD.w*2/3,WORLD.h); ctx.stroke();
    ctx.setLineDash([]);

    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(255,107,125,.72)';
    ctx.beginPath(); ctx.moveTo(3,0); ctx.lineTo(3,WORLD.h); ctx.stroke();
    ctx.strokeStyle = 'rgba(100,230,255,.72)';
    ctx.beginPath(); ctx.moveTo(WORLD.w-3,0); ctx.lineTo(WORLD.w-3,WORLD.h); ctx.stroke();

    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,.16)';
    ctx.beginPath(); ctx.moveTo(0,2); ctx.lineTo(WORLD.w,2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,WORLD.h-2); ctx.lineTo(WORLD.w,WORLD.h-2); ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,.12)';
    ctx.beginPath(); ctx.moveTo(WORLD.w/2,0); ctx.lineTo(WORLD.w/2,WORLD.h); ctx.stroke();
    ctx.beginPath(); ctx.arc(WORLD.w/2,WORLD.h/2,70,0,Math.PI*2); ctx.stroke();
  }

  function drawEmitter(e, isPlayer) {
    const attract = e.type === 'attract';
    const c = attract ? [100,230,255] : [255,107,125];
    const halo = ctx.createRadialGradient(e.x,e.y,8,e.x,e.y,130);
    halo.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},.28)`);
    halo.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(e.x,e.y,130,0,Math.PI*2); ctx.fill();

    ctx.lineWidth = isPlayer ? 6 : 4;
    ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},.95)`;
    ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},.16)`;
    ctx.beginPath(); ctx.arc(e.x,e.y,e.r,0,Math.PI*2); ctx.fill(); ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = '700 18px ui-sans-serif, system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(attract ? '−' : '+', e.x, e.y + 1);
    ctx.font = '700 12px ui-sans-serif, system-ui';
    ctx.fillStyle = 'rgba(255,255,255,.68)';
    ctx.fillText(isPlayer ? 'TU' : 'CPU', e.x, e.y + e.r + 24);
  }

  function drawBall() {
    const b = state.ball;
    for (let i=0;i<b.trail.length;i++) {
      const p = b.trail[i];
      const a = (i+1)/b.trail.length * .18;
      ctx.fillStyle = `rgba(255,213,106,${a})`;
      ctx.beginPath(); ctx.arc(p.x,p.y, 3 + i/b.trail.length*5,0,Math.PI*2); ctx.fill();
    }
    const g = ctx.createRadialGradient(b.x-4,b.y-5,2,b.x,b.y,b.r*2.3);
    g.addColorStop(0,'#fffbea');
    g.addColorStop(.38,'#ffd56a');
    g.addColorStop(1,'rgba(255,170,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(b.x,b.y,b.r*2.3,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = '#fff3bf';
    ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,Math.PI*2); ctx.fill();
  }

  function drawHud() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '900 46px ui-sans-serif, system-ui';
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.fillText(`${state.score.cpu}   —   ${state.score.player}`, WORLD.w/2, 24);
    ctx.font = '700 14px ui-sans-serif, system-ui';
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.fillText(`CPU ${state.cpu.type === 'attract' ? 'ATTRATTORE' : 'REPULSORE'}                         TU ${state.player.type === 'attract' ? 'ATTRATTORE' : 'REPULSORE'}`, WORLD.w/2, 78);

    if (paused && running) {
      ctx.fillStyle = 'rgba(5,8,22,.58)';
      ctx.fillRect(0,0,WORLD.w,WORLD.h);
      ctx.font = '900 64px ui-sans-serif, system-ui';
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.fillText('PAUSA', WORLD.w/2, WORLD.h/2);
    }
  }

  function render() {
    drawField();
    drawEmitter(state.cpu, false);
    drawEmitter(state.player, true);
    drawBall();
    drawHud();
  }

  function loop(now) {
    const elapsed = Math.min((now - lastTime) / 1000, .05);
    lastTime = now;
    accumulator += elapsed;
    const fixed = 1/120;
    while (accumulator >= fixed) {
      step(fixed);
      accumulator -= fixed;
    }
    render();
    requestAnimationFrame(loop);
  }

  choiceButtons.forEach(btn => btn.addEventListener('click', () => setPlayerType(btn.dataset.type)));
  startBtn.addEventListener('click', () => {
    menu.querySelector('h2').textContent = 'Difendi il tuo lato.';
    menu.querySelector('p').textContent = 'Tu sei a destra. Il computer è a sinistra. Muovi il tuo campo gravitazionale e impedisci alla pallina di toccare la parete destra.';
    startBtn.textContent = 'INIZIA — primo a 7';
    newMatch();
  });

  pauseBtn.addEventListener('click', () => {
    if (!running) return;
    paused = !paused;
    pauseBtn.textContent = paused ? 'Riprendi' : 'Pausa';
  });

  resetBtn.addEventListener('click', () => {
    running = false;
    paused = false;
    menu.style.display = 'grid';
    menu.querySelector('h2').textContent = 'Difendi il tuo lato.';
    menu.querySelector('p').textContent = 'Tu sei a destra. Il computer è a sinistra. Muovi il tuo campo gravitazionale e impedisci alla pallina di toccare la parete destra.';
    startBtn.textContent = 'INIZIA — primo a 7';
    state.score.player = state.score.cpu = 0;
    resetPositions();
  });

  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (['arrowleft','arrowright','arrowup','arrowdown','w','a','s','d',' '].includes(k)) e.preventDefault();
    if (k === ' ') {
      if (running) { paused = !paused; pauseBtn.textContent = paused ? 'Riprendi' : 'Pausa'; }
    } else keys.add(k);
  }, {passive:false});
  window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));

  canvas.addEventListener('pointerdown', e => {
    const p = worldFromClient(e.clientX,e.clientY);
    pointer.active = true; pointer.x = p.x; pointer.y = p.y;
    canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!pointer.active) return;
    const p = worldFromClient(e.clientX,e.clientY);
    pointer.x = p.x; pointer.y = p.y;
  });
  canvas.addEventListener('pointerup', () => pointer.active = false);
  canvas.addEventListener('pointercancel', () => pointer.active = false);

  window.addEventListener('resize', resize);
  resize();
  setPlayerType('attract');
  resetPositions();
  requestAnimationFrame(loop);
})();
