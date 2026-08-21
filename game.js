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
  const FIELD_RADIUS = { attract: 445, repel: 390 };
  const keys = new Set();
  const pointer = { active: false, x: 0, y: 0 };

  const MODES = {
    duel: { name:'DUEL', player:'repel', cpu:'repel', help:'Repulsore contro Repulsore: rapido, diretto, arcade.' },
    orbit: { name:'ORBIT', player:'attract', cpu:'attract', help:'Attrattore contro Attrattore: entra nella fascia luminosa; la fionda si aggancia facilmente.' },
    polarity: { name:'POLARITY', player:'attract', cpu:'repel', help:'Poli opposti: modalità asimmetrica e sperimentale.' }
  };

  let running=false, paused=false, lastTime=performance.now(), accumulator=0;
  let selectedMode='duel', selectedPolarity='attract', resetTimer=0;

  const state = {
    score:{player:0,cpu:0},
    ball:{x:WORLD.w/2,y:WORLD.h/2,vx:0,vy:0,r:12,trail:[]},
    player:{x:WORLD.w*.84,y:WORLD.h/2,r:42,type:'repel',maxSpeed:720,fieldR:FIELD_RADIUS.repel},
    cpu:{x:WORLD.w*.16,y:WORLD.h/2,r:42,type:'repel',maxSpeed:560,fieldR:FIELD_RADIUS.repel,think:0,targetX:WORLD.w*.16,targetY:WORLD.h/2}
  };

  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const opposite=t=>t==='attract'?'repel':'attract';
  const smooth01=x=>{x=clamp(x,0,1);return x*x*(3-2*x);};
  const fadeOut=(t,start=.72)=>1-smooth01((t-start)/(1-start));

  function resize(){
    const r=frame.getBoundingClientRect();
    const dpr=Math.min(window.devicePixelRatio||1,2);
    canvas.width=Math.round(r.width*dpr); canvas.height=Math.round(r.height*dpr);
    ctx.setTransform(canvas.width/WORLD.w,0,0,canvas.height/WORLD.h,0,0);
  }
  function worldFromClient(x,y){const r=canvas.getBoundingClientRect();return{x:(x-r.left)/r.width*WORLD.w,y:(y-r.top)/r.height*WORLD.h};}
  function setEmitterType(e,t){e.type=t;e.fieldR=FIELD_RADIUS[t];}
  function applyMode(){
    const m=MODES[selectedMode];
    if(selectedMode==='polarity'){setEmitterType(state.player,selectedPolarity);setEmitterType(state.cpu,opposite(selectedPolarity));}
    else{setEmitterType(state.player,m.player);setEmitterType(state.cpu,m.cpu);}
    modeButtons.forEach(b=>b.classList.toggle('active',b.dataset.mode===selectedMode));
    polarityButtons.forEach(b=>b.classList.toggle('active',b.dataset.polarity===selectedPolarity));
    polarityWrap.hidden=selectedMode!=='polarity'; modeHelp.textContent=m.help;
  }

  function resetPositions(serveToward=0){
    state.player.x=WORLD.w*.84; state.player.y=WORLD.h/2;
    state.cpu.x=WORLD.w*.16; state.cpu.y=WORLD.h/2;
    const b=state.ball; b.x=WORLD.w/2; b.y=WORLD.h/2+(Math.random()-.5)*160;
    const speed=500, angle=(Math.random()-.5)*.62, sign=serveToward||(Math.random()<.5?-1:1);
    b.vx=Math.cos(angle)*speed*sign; b.vy=Math.sin(angle)*speed; b.trail.length=0; resetTimer=.7;
  }
  function newMatch(){state.score.player=state.score.cpu=0;paused=false;pauseBtn.textContent='Pausa';applyMode();resetPositions();running=true;menu.style.display='none';lastTime=performance.now();accumulator=0;}
  function showToast(text,ms=700){toast.textContent=text;toast.classList.add('show');clearTimeout(showToast.t);showToast.t=setTimeout(()=>toast.classList.remove('show'),ms);}
  function endMatch(who){running=false;menu.style.display='grid';menu.querySelector('h2').textContent=who==='player'?'Hai vinto.':'Il computer ha vinto.';menu.querySelector('.intro').textContent=`Finale ${state.score.player} — ${state.score.cpu}. Cambia disciplina o gioca la rivincita.`;startBtn.textContent='RIVINCITA';}
  function scorePoint(who){state.score[who]++;showToast(who==='player'?'PUNTO TU':'PUNTO CPU',800);if(state.score[who]>=TARGET_SCORE)return endMatch(who);resetPositions(who==='player'?-1:1);}

  function moveToward(body,tx,ty,speed,dt){const dx=tx-body.x,dy=ty-body.y,d=Math.hypot(dx,dy);if(d<1)return;const s=Math.min(d,speed*dt);body.x+=dx/d*s;body.y+=dy/d*s;}
  function enforceZones(){state.player.x=clamp(state.player.x,WORLD.w/3+state.player.r,WORLD.w-state.player.r);state.cpu.x=clamp(state.cpu.x,state.cpu.r,WORLD.w*2/3-state.cpu.r);state.player.y=clamp(state.player.y,state.player.r,WORLD.h-state.player.r);state.cpu.y=clamp(state.cpu.y,state.cpu.r,WORLD.h-state.cpu.r);}
  function updatePlayer(dt){
    let tx=state.player.x,ty=state.player.y;
    if(pointer.active){tx=pointer.x;ty=pointer.y;} else {
      let dx=0,dy=0;if(keys.has('arrowleft')||keys.has('a'))dx--;if(keys.has('arrowright')||keys.has('d'))dx++;if(keys.has('arrowup')||keys.has('w'))dy--;if(keys.has('arrowdown')||keys.has('s'))dy++;
      if(dx||dy){const m=Math.hypot(dx,dy);tx+=dx/m*state.player.maxSpeed*dt;ty+=dy/m*state.player.maxSpeed*dt;}
    }
    moveToward(state.player,tx,ty,state.player.maxSpeed,dt);
  }
  function reflectedY(y){const span=WORLD.h*2;y=((y%span)+span)%span;return y>WORLD.h?span-y:y;}
  function updateCpu(dt){
    const c=state.cpu,b=state.ball;c.think-=dt;if(c.think>0)return;c.think=.12+Math.random()*.10;
    const travel=clamp((c.x-b.x)/(Math.abs(b.vx)+320),-.35,.55),py=reflectedY(b.y+b.vy*travel),danger=b.x<WORLD.w*.64||b.vx<0;
    if(c.type==='repel'){c.targetX=danger?b.x-155:WORLD.w*.16;c.targetY=py;}
    else{c.targetX=danger?b.x+145:WORLD.w*.27;const side=Math.sign(b.vy||(b.y-WORLD.h/2)||1);c.targetY=clamp(py+side*105,70,WORLD.h-70);}
    c.targetX=clamp(c.targetX,70,WORLD.w*2/3-55);moveToward(c,c.targetX,c.targetY,c.maxSpeed,dt);
  }

  function wallWeights(s){const r=s.fieldR;return{left:clamp(1-s.x/r,0,1),right:clamp(1-(WORLD.w-s.x)/r,0,1),top:clamp(1-s.y/r,0,1),bottom:clamp(1-(WORLD.h-s.y)/r,0,1)};}
  function bendAtWalls(s,b,fx,fy,w){
    const original=Math.hypot(fx,fy);if(!original)return{fx:0,fy:0};const bend=.80;
    if(w.left&&fx<0){const lost=-fx*w.left*bend;fx*=1-w.left*.70;fy+=Math.sign(b.y-s.y||fy||1)*lost;}
    if(w.right&&fx>0){const lost=fx*w.right*bend;fx*=1-w.right*.70;fy+=Math.sign(b.y-s.y||fy||1)*lost;}
    if(w.top&&fy<0){const lost=-fy*w.top*bend;fy*=1-w.top*.70;fx+=Math.sign(b.x-s.x||fx||1)*lost;}
    if(w.bottom&&fy>0){const lost=fy*w.bottom*bend;fy*=1-w.bottom*.70;fx+=Math.sign(b.x-s.x||fx||1)*lost;}
    const m=Math.hypot(fx,fy)||1,keep=original*.985;return{fx:fx/m*keep,fy:fy/m*keep};
  }

  function fieldForce(s,b){
    const dx=s.x-b.x,dy=s.y-b.y,d=Math.hypot(dx,dy);if(d<.01)return{ax:0,ay:0};
    const w=wallWeights(s),sx=1+1.05*(w.left+w.right),sy=1+1.05*(w.top+w.bottom);if(Math.hypot(dx*sx,dy*sy)>=s.fieldR)return{ax:0,ay:0};
    const tx=dx/d,ty=dy/d,t=clamp(d/s.fieldR,0,1);let fx=0,fy=0;
    if(s.type==='repel'){
      const strength=2700*Math.pow(1-t,.58)*fadeOut(t,.70);fx=-tx*strength;fy=-ty*strength;
    } else {
      const radialBand=Math.exp(-.5*Math.pow((t-.43)/.22,2));
      const radial=3450*radialBand*smooth01((t-.015)/.08)*fadeOut(t,.86);fx=tx*radial;fy=ty*radial;

      const tangentX=-ty,tangentY=tx;
      const tangentVelocity=b.vx*tangentX+b.vy*tangentY;
      const cross=b.vx*ty-b.vy*tx;
      const spin=Math.sign(tangentVelocity||cross||1);

      // EASY SLINGSHOT: la zona utile è larga e parte già con un assist minimo.
      // Un buon passaggio laterale aumenta ancora molto la potenza.
      const lateral=Math.abs(tangentVelocity);
      const passQuality=.42+.58*smooth01(lateral/90);
      const orbitBand=Math.exp(-.5*Math.pow((t-.42)/.29,2));
      const innerGate=smooth01((t-.02)/.06);
      const outerGate=fadeOut(t,.90);
      const speedGate=clamp(Math.hypot(b.vx,b.vy)/720,.58,1.30);
      const tangential=2550*orbitBand*innerGate*outerGate*speedGate*passQuality;
      fx+=tangentX*spin*tangential;fy+=tangentY*spin*tangential;
    }
    const bent=bendAtWalls(s,b,fx,fy,w);return{ax:bent.fx,ay:bent.fy};
  }

  function updateBall(dt){
    if(resetTimer>0){resetTimer-=dt;return;}const b=state.ball,fp=fieldForce(state.player,b),fc=fieldForce(state.cpu,b);b.vx+=(fp.ax+fc.ax)*dt;b.vy+=(fp.ay+fc.ay)*dt;
    const speed=Math.hypot(b.vx,b.vy),maxSpeed=selectedMode==='orbit'?1900:1600;if(speed>maxSpeed){b.vx=b.vx/speed*maxSpeed;b.vy=b.vy/speed*maxSpeed;}
    b.x+=b.vx*dt;b.y+=b.vy*dt;if(b.y-b.r<=0&&b.vy<0){b.y=b.r;b.vy=Math.abs(b.vy)*.985;}else if(b.y+b.r>=WORLD.h&&b.vy>0){b.y=WORLD.h-b.r;b.vy=-Math.abs(b.vy)*.985;}
    if(b.x+b.r<0)scorePoint('player');else if(b.x-b.r>WORLD.w)scorePoint('cpu');if(running){b.trail.push({x:b.x,y:b.y,speed:Math.hypot(b.vx,b.vy)});if(b.trail.length>34)b.trail.shift();}
  }

  function deformRingPoint(s,r,a){let x=s.x+Math.cos(a)*r,y=s.y+Math.sin(a)*r;const slide=.68,m=8;if(x<m){const o=m-x;x=m;y+=Math.sign(y-s.y||1)*o*slide;}if(x>WORLD.w-m){const o=x-(WORLD.w-m);x=WORLD.w-m;y+=Math.sign(y-s.y||1)*o*slide;}if(y<m){const o=m-y;y=m;x+=Math.sign(x-s.x||1)*o*slide;}if(y>WORLD.h-m){const o=y-(WORLD.h-m);y=WORLD.h-m;x+=Math.sign(x-s.x||1)*o*slide;}return{x:clamp(x,m,WORLD.w-m),y:clamp(y,m,WORLD.h-m)};}
  function ringPath(s,r){ctx.beginPath();for(let i=0;i<=104;i++){const p=deformRingPoint(s,r,i/104*Math.PI*2);if(!i)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);}}
  function drawRing(s,r,alpha,width=2,outer=false){const c=s.type==='attract'?'100,230,255':'255,107,125';ringPath(s,r);ctx.setLineDash([]);ctx.strokeStyle=`rgba(${c},${alpha*.28})`;ctx.lineWidth=width+7;ctx.stroke();ringPath(s,r);ctx.strokeStyle=`rgba(${c},${alpha})`;ctx.lineWidth=width;ctx.stroke();const pressure=Math.max(...Object.values(wallWeights(s)));if(outer&&pressure>.05){ringPath(s,r);ctx.setLineDash([22,15]);ctx.lineDashOffset=-(performance.now()*.055)%37;ctx.strokeStyle=`rgba(${c},${.20+.32*pressure})`;ctx.lineWidth=3.2;ctx.stroke();ctx.setLineDash([]);}}
  function drawWallPressure(s){const w=wallWeights(s),c=s.type==='attract'?'100,230,255':'255,107,125',now=performance.now();const h=(y,v)=>{if(v<=.04)return;const span=s.fieldR*(.58+.42*v);ctx.beginPath();ctx.moveTo(clamp(s.x-span,8,WORLD.w-8),y);ctx.lineTo(clamp(s.x+span,8,WORLD.w-8),y);ctx.setLineDash([18,16]);ctx.lineDashOffset=-(now*.04)%34;ctx.strokeStyle=`rgba(${c},${.20*v})`;ctx.lineWidth=3;ctx.stroke();};const v=(x,q)=>{if(q<=.04)return;const span=s.fieldR*(.58+.42*q);ctx.beginPath();ctx.moveTo(x,clamp(s.y-span,8,WORLD.h-8));ctx.lineTo(x,clamp(s.y+span,8,WORLD.h-8));ctx.setLineDash([18,16]);ctx.lineDashOffset=-(now*.04)%34;ctx.strokeStyle=`rgba(${c},${.20*q})`;ctx.lineWidth=3;ctx.stroke();};v(12,w.left);v(WORLD.w-12,w.right);h(12,w.top);h(WORLD.h-12,w.bottom);ctx.setLineDash([]);}

  function drawField(){ctx.clearRect(0,0,WORLD.w,WORLD.h);const g=ctx.createLinearGradient(0,0,WORLD.w,WORLD.h);g.addColorStop(0,'#07101e');g.addColorStop(.5,'#080b18');g.addColorStop(1,'#130812');ctx.fillStyle=g;ctx.fillRect(0,0,WORLD.w,WORLD.h);ctx.fillStyle='rgba(255,255,255,.20)';for(let i=0;i<46;i++)ctx.fillRect((i*347)%WORLD.w,(i*173+91)%WORLD.h,2,2);ctx.fillStyle='rgba(255,107,125,.028)';ctx.fillRect(0,0,WORLD.w*2/3,WORLD.h);ctx.fillStyle='rgba(100,230,255,.028)';ctx.fillRect(WORLD.w/3,0,WORLD.w*2/3,WORLD.h);ctx.setLineDash([12,16]);ctx.lineWidth=2;ctx.strokeStyle='rgba(255,255,255,.11)';ctx.beginPath();ctx.moveTo(WORLD.w/3,0);ctx.lineTo(WORLD.w/3,WORLD.h);ctx.stroke();ctx.beginPath();ctx.moveTo(WORLD.w*2/3,0);ctx.lineTo(WORLD.w*2/3,WORLD.h);ctx.stroke();ctx.setLineDash([]);ctx.lineWidth=8;ctx.strokeStyle='rgba(255,107,125,.68)';ctx.beginPath();ctx.moveTo(3,0);ctx.lineTo(3,WORLD.h);ctx.stroke();ctx.strokeStyle='rgba(100,230,255,.68)';ctx.beginPath();ctx.moveTo(WORLD.w-3,0);ctx.lineTo(WORLD.w-3,WORLD.h);ctx.stroke();ctx.lineWidth=3;ctx.strokeStyle='rgba(255,255,255,.15)';ctx.beginPath();ctx.moveTo(0,2);ctx.lineTo(WORLD.w,2);ctx.stroke();ctx.beginPath();ctx.moveTo(0,WORLD.h-2);ctx.lineTo(WORLD.w,WORLD.h-2);ctx.stroke();}
  function drawEmitter(e,isPlayer){const attract=e.type==='attract',c=attract?[100,230,255]:[255,107,125];drawWallPressure(e);const rings=attract?[.16,.28,.40,.54,.70,.86,1]:[.18,.36,.54,.76,1];rings.forEach(f=>{const peak=attract?Math.max(0,1-Math.abs(f-.42)*1.8):(1-f)*.68+.18;drawRing(e,e.fieldR*f,.12+peak*.28,f===1?3.2:1.8,f===1);});if(attract){drawRing(e,e.fieldR*.30,.30,3,false);drawRing(e,e.fieldR*.44,.55,5,false);drawRing(e,e.fieldR*.60,.30,3,false);}const halo=ctx.createRadialGradient(e.x,e.y,5,e.x,e.y,105);halo.addColorStop(0,`rgba(${c[0]},${c[1]},${c[2]},.22)`);halo.addColorStop(1,`rgba(${c[0]},${c[1]},${c[2]},0)`);ctx.fillStyle=halo;ctx.beginPath();ctx.arc(e.x,e.y,105,0,Math.PI*2);ctx.fill();ctx.lineWidth=isPlayer?6:4;ctx.strokeStyle=`rgba(${c[0]},${c[1]},${c[2]},.96)`;ctx.fillStyle=`rgba(${c[0]},${c[1]},${c[2]},.10)`;ctx.beginPath();ctx.arc(e.x,e.y,e.r,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#fff';ctx.font='800 18px ui-sans-serif,system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(attract?'A':'R',e.x,e.y+1);ctx.font='700 12px ui-sans-serif,system-ui';ctx.fillStyle='rgba(255,255,255,.68)';ctx.fillText(isPlayer?'TU':'CPU',e.x,e.y+e.r+23);}
  function drawBall(){const b=state.ball;for(let i=0;i<b.trail.length;i++){const p=b.trail[i],q=(i+1)/b.trail.length,hot=clamp((p.speed-650)/1150,0,1);ctx.fillStyle=`rgba(255,213,106,${q*(.12+.20*hot)})`;ctx.beginPath();ctx.arc(p.x,p.y,3+q*(5+6*hot),0,Math.PI*2);ctx.fill();}const g=ctx.createRadialGradient(b.x-4,b.y-5,2,b.x,b.y,b.r*2.5);g.addColorStop(0,'#fffbea');g.addColorStop(.38,'#ffd56a');g.addColorStop(1,'rgba(255,170,40,0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(b.x,b.y,b.r*2.5,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff3bf';ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,Math.PI*2);ctx.fill();}
  function typeName(t){return t==='attract'?'ATTRATTORE':'REPULSORE';}
  function drawHud(){ctx.textAlign='center';ctx.textBaseline='top';ctx.font='900 46px ui-sans-serif,system-ui';ctx.fillStyle='rgba(255,255,255,.92)';ctx.fillText(`${state.score.cpu}   —   ${state.score.player}`,WORLD.w/2,22);ctx.font='750 14px ui-sans-serif,system-ui';ctx.fillStyle='rgba(255,255,255,.55)';ctx.fillText(`${MODES[selectedMode].name} · CPU ${typeName(state.cpu.type)}                         TU ${typeName(state.player.type)}`,WORLD.w/2,76);if(selectedMode==='orbit'){ctx.font='700 12px ui-sans-serif,system-ui';ctx.fillStyle='rgba(100,230,255,.72)';ctx.fillText('FIONDA ASSISTITA: basta entrare nella fascia luminosa; più sei decentrato, più accelera',WORLD.w/2,100);}if(paused&&running){ctx.fillStyle='rgba(5,8,22,.58)';ctx.fillRect(0,0,WORLD.w,WORLD.h);ctx.font='900 64px ui-sans-serif,system-ui';ctx.fillStyle='#fff';ctx.textBaseline='middle';ctx.fillText('PAUSA',WORLD.w/2,WORLD.h/2);}}
  function render(){drawField();drawEmitter(state.cpu,false);drawEmitter(state.player,true);drawBall();drawHud();}
  function step(dt){if(!running||paused)return;updatePlayer(dt);updateCpu(dt);enforceZones();updateBall(dt);}
  function loop(now){const elapsed=Math.min((now-lastTime)/1000,.05);lastTime=now;accumulator+=elapsed;const fixed=1/120;while(accumulator>=fixed){step(fixed);accumulator-=fixed;}render();requestAnimationFrame(loop);}

  modeButtons.forEach(b=>b.addEventListener('click',()=>{selectedMode=b.dataset.mode;applyMode();}));
  polarityButtons.forEach(b=>b.addEventListener('click',()=>{selectedPolarity=b.dataset.polarity;applyMode();}));
  startBtn.addEventListener('click',()=>{menu.querySelector('h2').textContent='Difendi il tuo lato.';menu.querySelector('.intro').textContent='Tu sei a destra. Muovi il generatore magnetico: la pallina reagisce solo dentro gli anelli del campo.';startBtn.textContent='INIZIA — primo a 7';newMatch();});
  pauseBtn.addEventListener('click',()=>{if(!running)return;paused=!paused;pauseBtn.textContent=paused?'Riprendi':'Pausa';});
  resetBtn.addEventListener('click',()=>{running=false;paused=false;state.score.player=state.score.cpu=0;resetPositions();applyMode();menu.style.display='grid';menu.querySelector('h2').textContent='Difendi il tuo lato.';menu.querySelector('.intro').textContent='Tu sei a destra. Muovi il generatore magnetico: la pallina reagisce solo dentro gli anelli del campo.';startBtn.textContent='INIZIA — primo a 7';});
  window.addEventListener('keydown',e=>{const k=e.key.toLowerCase();if(['arrowleft','arrowright','arrowup','arrowdown','w','a','s','d',' '].includes(k))e.preventDefault();if(k===' '){if(running){paused=!paused;pauseBtn.textContent=paused?'Riprendi':'Pausa';}}else keys.add(k);},{passive:false});
  window.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));
  canvas.addEventListener('pointerdown',e=>{const p=worldFromClient(e.clientX,e.clientY);pointer.active=true;pointer.x=p.x;pointer.y=p.y;canvas.setPointerCapture?.(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{if(!pointer.active)return;const p=worldFromClient(e.clientX,e.clientY);pointer.x=p.x;pointer.y=p.y;});
  canvas.addEventListener('pointerup',()=>pointer.active=false);canvas.addEventListener('pointercancel',()=>pointer.active=false);
  window.addEventListener('resize',resize);resize();applyMode();resetPositions();requestAnimationFrame(loop);
})();
