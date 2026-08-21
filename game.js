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
  const modeButtons = [...document.querySelectorAll('[data-mode]')];
  const polarityWrap = document.getElementById('polarityChoices');
  const polarityButtons = [...document.querySelectorAll('[data-polarity]')];
  const modeHelp = document.getElementById('modeHelp');

  const WORLD = { w: 1600, h: 900 };
  const TARGET_SCORE = 7;
  const FIELD_RADIUS = { attract: 430, repel: 390 };
  const keys = new Set();
  const pointer = { active: false, x: 0, y: 0 };

  const MODES = {
    duel: {
      name: 'DUEL', player: 'repel', cpu: 'repel',
      help: 'Repulsore contro Repulsore: rapido, diretto, arcade.'
    },
    orbit: {
      name: 'ORBIT', player: 'attract', cpu: 'attract',
      help: 'Attrattore contro Attrattore: passa decentrato nella fascia luminosa e crea vere fionde orbitali.'
    },
    polarity: {
      name: 'POLARITY', player: 'attract', cpu: 'repel',
      help: 'Poli opposti: modalità asimmetrica e sperimentale.'
    }
  };

  let dpr = 1;
  let running = false;
  let paused = false;
  let lastTime = performance.now();
  let accumulator = 0;
  let selectedMode = 'duel';
  let selectedPolarity = 'attract';
  let resetTimer = 0;

  const state = {
    score: { player: 0, cpu: 0 },
    ball: { x: WORLD.w/2, y: WORLD.h/2, vx: 0, vy: 0, r: 12, trail: [] },
    player: { x: WORLD.w*.84, y: WORLD.h/2, r: 42, type: 'repel', maxSpeed: 720, fieldR: FIELD_RADIUS.repel },
    cpu: { x: WORLD.w*.16, y: WORLD.h/2, r: 42, type: 'repel', maxSpeed: 560, fieldR: FIELD_RADIUS.repel, think: 0, targetX: WORLD.w*.16, targetY: WORLD.h/2 }
  };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function opposite(type) { return type === 'attract' ? 'repel' : 'attract'; }
  function smooth01(x) { x = clamp(x, 0, 1); return x*x*(3-2*x); }
  function fadeOut(t, start=.72) { return 1 - smooth01((t-start)/(1-start)); }

  function resize() {
    const rect = frame.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width*dpr);
    canvas.height = Math.round(rect.height*dpr);
    ctx.setTransform(canvas.width/WORLD.w, 0, 0, canvas.height/WORLD.h, 0, 0);
  }

  function worldFromClient(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX-rect.left)/rect.width*WORLD.w,
      y: (clientY-rect.top)/rect.height*WORLD.h
    };
  }

  function setEmitterType(emitter, type) {
    emitter.type = type;
    emitter.fieldR = FIELD_RADIUS[type];
  }

  function applyMode() {
    const mode = MODES[selectedMode];
    if (selectedMode === 'polarity') {
      setEmitterType(state.player, selectedPolarity);
      setEmitterType(state.cpu, opposite(selectedPolarity));
    } else {
      setEmitterType(state.player, mode.player);
      setEmitterType(state.cpu, mode.cpu);
    }
    modeButtons.forEach(b => b.classList.toggle('active', b.dataset.mode === selectedMode));
    polarityButtons.forEach(b => b.classList.toggle('active', b.dataset.polarity === selectedPolarity));
    polarityWrap.hidden = selectedMode !== 'polarity';
    modeHelp.textContent = mode.help;
  }

  function setMode(mode) { selectedMode = mode; applyMode(); }
  function setPolarity(type) { selectedPolarity = type; applyMode(); }

  function resetPositions(serveToward=0) {
    state.player.x = WORLD.w*.84; state.player.y = WORLD.h/2;
    state.cpu.x = WORLD.w*.16; state.cpu.y = WORLD.h/2;
    state.ball.x = WORLD.w/2;
    state.ball.y = WORLD.h/2 + (Math.random()-.5)*160;
    const speed = 500;
    const angle = (Math.random()-.5)*.62;
    const sign = serveToward || (Math.random()<.5 ? -1 : 1);
    state.ball.vx = Math.cos(angle)*speed*sign;
    state.ball.vy = Math.sin(angle)*speed;
    state.ball.trail.length = 0;
    resetTimer = .7;
  }

  function newMatch() {
    state.score.player = state.score.cpu = 0;
    paused = false;
    pauseBtn.textContent = 'Pausa';
    applyMode();
    resetPositions();
    running = true;
    menu.style.display = 'none';
    lastTime = performance.now();
    accumulator = 0;
  }

  function showToast(text, ms=700) {
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => toast.classList.remove('show'), ms);
  }

  function endMatch(who) {
    running = false;
    menu.style.display = 'grid';
    menu.querySelector('h2').textContent = who === 'player' ? 'Hai vinto.' : 'Il computer ha vinto.';
    menu.querySelector('.intro').textContent = `Finale ${state.score.player} — ${state.score.cpu}. Cambia disciplina o gioca la rivincita.`;
    startBtn.textContent = 'RIVINCITA';
  }

  function scorePoint(who) {
    state.score[who] += 1;
    showToast(who === 'player' ? 'PUNTO TU' : 'PUNTO CPU', 800);
    if (state.score[who] >= TARGET_SCORE) return endMatch(who);
    resetPositions(who === 'player' ? -1 : 1);
  }

  function moveToward(body, tx, ty, speed, dt) {
    const dx = tx-body.x, dy = ty-body.y;
    const d = Math.hypot(dx,dy);
    if (d < 1) return;
    const step = Math.min(d, speed*dt);
    body.x += dx/d*step;
    body.y += dy/d*step;
  }

  function enforceZones() {
    state.player.x = clamp(state.player.x, WORLD.w/3 + state.player.r, WORLD.w-state.player.r);
    state.cpu.x = clamp(state.cpu.x, state.cpu.r, WORLD.w*2/3-state.cpu.r);
    state.player.y = clamp(state.player.y, state.player.r, WORLD.h-state.player.r);
    state.cpu.y = clamp(state.cpu.y, state.cpu.r, WORLD.h-state.cpu.r);
  }

  function updatePlayer(dt) {
    let tx = state.player.x, ty = state.player.y;
    if (pointer.active) {
      tx = pointer.x; ty = pointer.y;
    } else {
      let dx=0, dy=0;
      if (keys.has('arrowleft') || keys.has('a')) dx--;
      if (keys.has('arrowright') || keys.has('d')) dx++;
      if (keys.has('arrowup') || keys.has('w')) dy--;
      if (keys.has('arrowdown') || keys.has('s')) dy++;
      if (dx || dy) {
        const m = Math.hypot(dx,dy);
        tx += dx/m*state.player.maxSpeed*dt;
        ty += dy/m*state.player.maxSpeed*dt;
      }
    }
    moveToward(state.player, tx, ty, state.player.maxSpeed, dt);
  }

  function reflectedY(y) {
    const span = WORLD.h*2;
    y = ((y%span)+span)%span;
    return y > WORLD.h ? span-y : y;
  }

  function updateCpu(dt) {
    const cpu = state.cpu, b = state.ball;
    cpu.think -= dt;
    if (cpu.think <= 0) {
      cpu.think = .12 + Math.random()*.10;
      const travel = clamp((cpu.x-b.x)/(Math.abs(b.vx)+320), -.35, .55);
      const predictedY = reflectedY(b.y+b.vy*travel);
      const danger = b.x < WORLD.w*.64 || b.vx < 0;

      if (cpu.type === 'repel') {
        cpu.targetX = danger ? b.x-155 : WORLD.w*.16;
        cpu.targetY = predictedY;
      } else {
        cpu.targetX = danger ? b.x+165 : WORLD.w*.27;
        const side = Math.sign(b.vy || (b.y-WORLD.h/2) || 1);
        cpu.targetY = clamp(predictedY + side*145, 75, WORLD.h-75);
      }
      cpu.targetX = clamp(cpu.targetX, 70, WORLD.w*2/3-55);
    }
    moveToward(cpu, cpu.targetX, cpu.targetY, cpu.maxSpeed, dt);
  }

  function wallWeights(source) {
    const r = source.fieldR;
    return {
      left: clamp(1-source.x/r, 0, 1),
      right: clamp(1-(WORLD.w-source.x)/r, 0, 1),
      top: clamp(1-source.y/r, 0, 1),
      bottom: clamp(1-(WORLD.h-source.y)/r, 0, 1)
    };
  }

  function bendVectorAtWalls(source, ball, fx, fy, weights) {
    const original = Math.hypot(fx,fy);
    if (!original) return {fx:0, fy:0};
    const bend=.80;

    if (weights.left && fx < 0) {
      const lost=-fx*weights.left*bend;
      fx *= 1-weights.left*.70;
      fy += Math.sign(ball.y-source.y || fy || 1)*lost;
    }
    if (weights.right && fx > 0) {
      const lost=fx*weights.right*bend;
      fx *= 1-weights.right*.70;
      fy += Math.sign(ball.y-source.y || fy || 1)*lost;
    }
    if (weights.top && fy < 0) {
      const lost=-fy*weights.top*bend;
      fy *= 1-weights.top*.70;
      fx += Math.sign(ball.x-source.x || fx || 1)*lost;
    }
    if (weights.bottom && fy > 0) {
      const lost=fy*weights.bottom*bend;
      fy *= 1-weights.bottom*.70;
      fx += Math.sign(ball.x-source.x || fx || 1)*lost;
    }

    const bent = Math.hypot(fx,fy) || 1;
    const keep = original*.985;
    return { fx:fx/bent*keep, fy:fy/bent*keep };
  }

  function fieldForce(source, ball) {
    const dx = source.x-ball.x;
    const dy = source.y-ball.y;
    const rawD = Math.hypot(dx,dy);
    if (rawD < .01) return {ax:0, ay:0};

    const w = wallWeights(source);
    const sx = 1 + 1.05*(w.left+w.right);
    const sy = 1 + 1.05*(w.top+w.bottom);
    const warpedD = Math.hypot(dx*sx, dy*sy);
    if (warpedD >= source.fieldR) return {ax:0, ay:0};

    const towardX = dx/rawD;
    const towardY = dy/rawD;
    const t = clamp(rawD/source.fieldR, 0, 1);
    let fx=0, fy=0;

    if (source.type === 'repel') {
      const strength = 2700*Math.pow(1-t,.58)*fadeOut(t,.70);
      fx = -towardX*strength;
      fy = -towardY*strength;
    } else {
      const ring = Math.exp(-.5*Math.pow((t-.43)/.19,2));
      const coreGate = smooth01((t-.02)/.11);
      const radial = 3600*ring*coreGate*fadeOut(t,.82);
      fx = towardX*radial;
      fy = towardY*radial;

      const tangentX = -towardY;
      const tangentY = towardX;
      const tangentVelocity = ball.vx*tangentX + ball.vy*tangentY;
      const passQuality = smooth01(Math.abs(tangentVelocity)/220);
      if (passQuality > 0) {
        const spin = Math.sign(tangentVelocity);
        const orbitBand = Math.exp(-.5*Math.pow((t-.36)/.18,2));
        const innerGate = smooth01((t-.07)/.13);
        const speedGate = clamp(Math.hypot(ball.vx,ball.vy)/850,.42,1.25);
        const tangential = 2200*orbitBand*innerGate*fadeOut(t,.74)*speedGate*passQuality;
        fx += tangentX*spin*tangential;
        fy += tangentY*spin*tangential;
      }
    }

    const bent = bendVectorAtWalls(source,ball,fx,fy,w);
    return { ax:bent.fx, ay:bent.fy };
  }

  function updateBall(dt) {
    if (resetTimer > 0) { resetTimer -= dt; return; }
    const b = state.ball;
    const fp = fieldForce(state.player,b);
    const fc = fieldForce(state.cpu,b);
    b.vx += (fp.ax+fc.ax)*dt;
    b.vy += (fp.ay+fc.ay)*dt;

    const speed = Math.hypot(b.vx,b.vy);
    const maxSpeed = selectedMode === 'orbit' ? 1850 : 1600;
    if (speed > maxSpeed) {
      b.vx = b.vx/speed*maxSpeed;
      b.vy = b.vy/speed*maxSpeed;
    }

    b.x += b.vx*dt; b.y += b.vy*dt;
    if (b.y-b.r <= 0 && b.vy < 0) { b.y=b.r; b.vy=Math.abs(b.vy)*.985; }
    else if (b.y+b.r >= WORLD.h && b.vy > 0) { b.y=WORLD.h-b.r; b.vy=-Math.abs(b.vy)*.985; }

    if (b.x+b.r < 0) scorePoint('player');
    else if (b.x-b.r > WORLD.w) scorePoint('cpu');

    if (running) {
      b.trail.push({x:b.x,y:b.y,speed:Math.hypot(b.vx,b.vy)});
      if (b.trail.length > 32) b.trail.shift();
    }
  }

  function step(dt) {
    if (!running || paused) return;
    updatePlayer(dt); updateCpu(dt); enforceZones(); updateBall(dt);
  }

  function drawField() {
    ctx.clearRect(0,0,WORLD.w,WORLD.h);
    const grad = ctx.createLinearGradient(0,0,WORLD.w,WORLD.h);
    grad.addColorStop(0,'#07101e'); grad.addColorStop(.5,'#080b18'); grad.addColorStop(1,'#130812');
    ctx.fillStyle=grad; ctx.fillRect(0,0,WORLD.w,WORLD.h);

    ctx.fillStyle='rgba(255,255,255,.20)';
    for (let i=0;i<46;i++) ctx.fillRect((i*347)%WORLD.w,(i*173+91)%WORLD.h,2,2);

    ctx.fillStyle='rgba(255,107,125,.028)'; ctx.fillRect(0,0,WORLD.w*2/3,WORLD.h);
    ctx.fillStyle='rgba(100,230,255,.028)'; ctx.fillRect(WORLD.w/3,0,WORLD.w*2/3,WORLD.h);
    ctx.setLineDash([12,16]); ctx.lineWidth=2; ctx.strokeStyle='rgba(255,255,255,.11)';
    ctx.beginPath(); ctx.moveTo(WORLD.w/3,0); ctx.lineTo(WORLD.w/3,WORLD.h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(WORLD.w*2/3,0); ctx.lineTo(WORLD.w*2/3,WORLD.h); ctx.stroke(); ctx.setLineDash([]);

    ctx.lineWidth=8; ctx.strokeStyle='rgba(255,107,125,.68)';
    ctx.beginPath(); ctx.moveTo(3,0); ctx.lineTo(3,WORLD.h); ctx.stroke();
    ctx.strokeStyle='rgba(100,230,255,.68)'; ctx.beginPath(); ctx.moveTo(WORLD.w-3,0); ctx.lineTo(WORLD.w-3,WORLD.h); ctx.stroke();
    ctx.lineWidth=3; ctx.strokeStyle='rgba(255,255,255,.15)';
    ctx.beginPath(); ctx.moveTo(0,2); ctx.lineTo(WORLD.w,2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,WORLD.h-2); ctx.lineTo(WORLD.w,WORLD.h-2); ctx.stroke();
    ctx.strokeStyle='rgba(255,255,255,.10)'; ctx.beginPath(); ctx.moveTo(WORLD.w/2,0); ctx.lineTo(WORLD.w/2,WORLD.h); ctx.stroke();
  }

  function deformRingPoint(source, radius, angle) {
    let x = source.x+Math.cos(angle)*radius;
    let y = source.y+Math.sin(angle)*radius;
    const slide=.68, margin=8;

    if (x < margin) { const o=margin-x; x=margin; y += Math.sign(y-source.y || 1)*o*slide; }
    if (x > WORLD.w-margin) { const o=x-(WORLD.w-margin); x=WORLD.w-margin; y += Math.sign(y-source.y || 1)*o*slide; }
    if (y < margin) { const o=margin-y; y=margin; x += Math.sign(x-source.x || 1)*o*slide; }
    if (y > WORLD.h-margin) { const o=y-(WORLD.h-margin); y=WORLD.h-margin; x += Math.sign(x-source.x || 1)*o*slide; }
    return {x:clamp(x,margin,WORLD.w-margin), y:clamp(y,margin,WORLD.h-margin)};
  }

  function ringPath(source,radius) {
    ctx.beginPath();
    const segments=104;
    for (let i=0;i<=segments;i++) {
      const p=deformRingPoint(source,radius,i/segments*Math.PI*2);
      if (i===0) ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y);
    }
  }

  function drawRing(source, radius, alpha, width=2, outer=false) {
    const c = source.type==='attract' ? '100,230,255' : '255,107,125';
    ringPath(source,radius);
    ctx.setLineDash([]);
    ctx.strokeStyle=`rgba(${c},${alpha*.28})`; ctx.lineWidth=width+7; ctx.stroke();
    ringPath(source,radius);
    ctx.strokeStyle=`rgba(${c},${alpha})`; ctx.lineWidth=width; ctx.stroke();

    const pressure = Math.max(...Object.values(wallWeights(source)));
    if (outer && pressure>.05) {
      ringPath(source,radius);
      ctx.setLineDash([22,15]);
      ctx.lineDashOffset = -(performance.now()*.055)%37;
      ctx.strokeStyle=`rgba(${c},${.20+.32*pressure})`;
      ctx.lineWidth=3.2;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawWallPressure(source) {
    const w=wallWeights(source);
    const c=source.type==='attract' ? '100,230,255' : '255,107,125';
    const now=performance.now();
    const drawHorizontal=(y,weight) => {
      if (weight<=.04) return;
      const span=source.fieldR*(.58+.42*weight);
      for (let i=0;i<3;i++) {
        ctx.beginPath();
        ctx.moveTo(clamp(source.x-span,8,WORLD.w-8),y);
        ctx.lineTo(clamp(source.x+span,8,WORLD.w-8),y);
        ctx.setLineDash([18,16]); ctx.lineDashOffset=-(now*.04+i*9)%34;
        ctx.strokeStyle=`rgba(${c},${(.06+i*.035)*weight})`; ctx.lineWidth=2+i*.7; ctx.stroke();
      }
    };
    const drawVertical=(x,weight) => {
      if (weight<=.04) return;
      const span=source.fieldR*(.58+.42*weight);
      for (let i=0;i<3;i++) {
        ctx.beginPath();
        ctx.moveTo(x,clamp(source.y-span,8,WORLD.h-8));
        ctx.lineTo(x,clamp(source.y+span,8,WORLD.h-8));
        ctx.setLineDash([18,16]); ctx.lineDashOffset=-(now*.04+i*9)%34;
        ctx.strokeStyle=`rgba(${c},${(.06+i*.035)*weight})`; ctx.lineWidth=2+i*.7; ctx.stroke();
      }
    };
    drawVertical(12,w.left); drawVertical(WORLD.w-12,w.right);
    drawHorizontal(12,w.top); drawHorizontal(WORLD.h-12,w.bottom);
    ctx.setLineDash([]);
  }

  function drawEmitter(e,isPlayer) {
    const attract=e.type==='attract';
    const c=attract ? [100,230,255] : [255,107,125];

    drawWallPressure(e);
    const rings=[.18,.36,.54,.76,1];
    rings.forEach(f => {
      const peak = attract ? Math.max(0,1-Math.abs(f-.36)*2.8) : (1-f)*.68+.18;
      drawRing(e,e.fieldR*f,.12+peak*.28,f===1?3.2:1.8,f===1);
    });

    if (attract) drawRing(e,e.fieldR*.36,.48,4.4,false);

    const halo=ctx.createRadialGradient(e.x,e.y,5,e.x,e.y,105);
    halo.addColorStop(0,`rgba(${c[0]},${c[1]},${c[2]},.22)`); halo.addColorStop(1,`rgba(${c[0]},${c[1]},${c[2]},0)`);
    ctx.fillStyle=halo; ctx.beginPath(); ctx.arc(e.x,e.y,105,0,Math.PI*2); ctx.fill();

    ctx.lineWidth=isPlayer?6:4; ctx.strokeStyle=`rgba(${c[0]},${c[1]},${c[2]},.96)`;
    ctx.fillStyle=`rgba(${c[0]},${c[1]},${c[2]},.10)`; ctx.beginPath(); ctx.arc(e.x,e.y,e.r,0,Math.PI*2); ctx.fill(); ctx.stroke();

    ctx.fillStyle='#fff'; ctx.font='800 18px ui-sans-serif,system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(attract?'A':'R',e.x,e.y+1);
    ctx.font='700 12px ui-sans-serif,system-ui'; ctx.fillStyle='rgba(255,255,255,.68)';
    ctx.fillText(isPlayer?'TU':'CPU',e.x,e.y+e.r+23);
  }

  function drawBall() {
    const b=state.ball;
    for (let i=0;i<b.trail.length;i++) {
      const p=b.trail[i], progress=(i+1)/b.trail.length;
      const hot=clamp((p.speed-650)/1100,0,1);
      ctx.fillStyle=`rgba(255,213,106,${progress*(.12+.18*hot)})`;
      ctx.beginPath(); ctx.arc(p.x,p.y,3+progress*(5+5*hot),0,Math.PI*2); ctx.fill();
    }
    const g=ctx.createRadialGradient(b.x-4,b.y-5,2,b.x,b.y,b.r*2.5);
    g.addColorStop(0,'#fffbea'); g.addColorStop(.38,'#ffd56a'); g.addColorStop(1,'rgba(255,170,40,0)');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(b.x,b.y,b.r*2.5,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#fff3bf'; ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,Math.PI*2); ctx.fill();
  }

  function typeName(t) { return t==='attract' ? 'ATTRATTORE' : 'REPULSORE'; }

  function drawHud() {
    ctx.textAlign='center'; ctx.textBaseline='top'; ctx.font='900 46px ui-sans-serif,system-ui'; ctx.fillStyle='rgba(255,255,255,.92)';
    ctx.fillText(`${state.score.cpu}   —   ${state.score.player}`,WORLD.w/2,22);
    ctx.font='750 14px ui-sans-serif,system-ui'; ctx.fillStyle='rgba(255,255,255,.55)';
    ctx.fillText(`${MODES[selectedMode].name} · CPU ${typeName(state.cpu.type)}                         TU ${typeName(state.player.type)}`,WORLD.w/2,76);
    if (selectedMode==='orbit') {
      ctx.font='700 12px ui-sans-serif,system-ui'; ctx.fillStyle='rgba(100,230,255,.62)';
      ctx.fillText('FIONDA: fai attraversare alla pallina l’anello luminoso in modo decentrato',WORLD.w/2,100);
    }
    if (paused && running) {
      ctx.fillStyle='rgba(5,8,22,.58)'; ctx.fillRect(0,0,WORLD.w,WORLD.h);
      ctx.font='900 64px ui-sans-serif,system-ui'; ctx.fillStyle='#fff'; ctx.textBaseline='middle'; ctx.fillText('PAUSA',WORLD.w/2,WORLD.h/2);
    }
  }

  function render() { drawField(); drawEmitter(state.cpu,false); drawEmitter(state.player,true); drawBall(); drawHud(); }

  function loop(now) {
    const elapsed=Math.min((now-lastTime)/1000,.05); lastTime=now; accumulator+=elapsed;
    const fixed=1/120;
    while (accumulator>=fixed) { step(fixed); accumulator-=fixed; }
    render(); requestAnimationFrame(loop);
  }

  modeButtons.forEach(btn => btn.addEventListener('click',()=>setMode(btn.dataset.mode)));
  polarityButtons.forEach(btn => btn.addEventListener('click',()=>setPolarity(btn.dataset.polarity)));
  startBtn.addEventListener('click',()=>{
    menu.querySelector('h2').textContent='Difendi il tuo lato.';
    menu.querySelector('.intro').textContent='Tu sei a destra. Muovi il generatore magnetico: la pallina può attraversarlo, ma reagisce solo dentro gli anelli del campo.';
    startBtn.textContent='INIZIA — primo a 7'; newMatch();
  });
  pauseBtn.addEventListener('click',()=>{
    if (!running) return; paused=!paused; pauseBtn.textContent=paused?'Riprendi':'Pausa';
  });
  resetBtn.addEventListener('click',()=>{
    running=false; paused=false; state.score.player=state.score.cpu=0; resetPositions(); applyMode();
    menu.style.display='grid'; menu.querySelector('h2').textContent='Difendi il tuo lato.';
    menu.querySelector('.intro').textContent='Tu sei a destra. Muovi il generatore magnetico: la pallina può attraversarlo, ma reagisce solo dentro gli anelli del campo.';
    startBtn.textContent='INIZIA — primo a 7';
  });

  window.addEventListener('keydown',e=>{
    const k=e.key.toLowerCase();
    if (['arrowleft','arrowright','arrowup','arrowdown','w','a','s','d',' '].includes(k)) e.preventDefault();
    if (k===' ') { if (running) { paused=!paused; pauseBtn.textContent=paused?'Riprendi':'Pausa'; } }
    else keys.add(k);
  },{passive:false});
  window.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));

  canvas.addEventListener('pointerdown',e=>{
    const p=worldFromClient(e.clientX,e.clientY); pointer.active=true; pointer.x=p.x; pointer.y=p.y; canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener('pointermove',e=>{
    if (!pointer.active) return; const p=worldFromClient(e.clientX,e.clientY); pointer.x=p.x; pointer.y=p.y;
  });
  canvas.addEventListener('pointerup',()=>pointer.active=false);
  canvas.addEventListener('pointercancel',()=>pointer.active=false);

  window.addEventListener('resize',resize);
  resize(); applyMode(); resetPositions(); requestAnimationFrame(loop);
})();
