(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const frame = $('frame');
  const roleMeterText = $('roleMeterText');
  const roleMeter = $('roleMeter');
  const playerTypeLabel = $('playerTypeLabel');
  const statusLine = $('statusLine');
  const menu = $('menu');

  if (!frame || !roleMeterText || !playerTypeLabel) return;

  const style = document.createElement('style');
  style.textContent = `
    .orbitCoach{
      position:absolute;right:18px;bottom:104px;z-index:11;width:min(300px,38%);
      padding:11px 13px;border:1px solid rgba(93,231,255,.24);border-radius:13px;
      background:rgba(2,8,18,.80);backdrop-filter:blur(12px);pointer-events:none;
      opacity:0;transform:translateY(8px);transition:.16s ease;
      box-shadow:0 12px 38px rgba(0,0,0,.34)
    }
    .orbitCoach.show{opacity:1;transform:translateY(0)}
    .orbitCoach .ocStep{display:block;color:#8190ae;font-size:8px;font-weight:900;letter-spacing:.18em;margin-bottom:3px}
    .orbitCoach .ocTitle{display:block;color:#eafaff;font-size:13px;font-weight:950;letter-spacing:.05em}
    .orbitCoach .ocSub{display:block;margin-top:4px;color:#8797b7;font-size:9px;line-height:1.4}
    .orbitCoach .ocFlow{display:flex;gap:5px;align-items:center;margin-top:8px;font-size:7px;font-weight:900;letter-spacing:.08em;color:#657592}
    .orbitCoach .ocFlow i{font-style:normal;padding:3px 5px;border-radius:999px;border:1px solid rgba(255,255,255,.08)}
    .orbitCoach .ocFlow b{color:#ffd66b}

    .frame[data-orbit-coach="spin"] .orbitCoach{
      border-color:rgba(255,214,107,.42);box-shadow:0 12px 38px rgba(0,0,0,.34),0 0 26px rgba(255,214,107,.08)
    }
    .frame[data-orbit-coach="spin"] .orbitCoach .ocTitle{color:#ffe69a}
    .frame[data-orbit-coach="spin"] #roleMeter{border-color:rgba(255,214,107,.38)}
    .frame[data-orbit-coach="spin"] #roleMeterFill{background:linear-gradient(90deg,#5de7ff,#ffd66b);box-shadow:0 0 13px rgba(255,214,107,.28)}

    .frame[data-orbit-coach="ready"] .orbitCoach{
      border-color:rgba(255,214,107,.88);background:rgba(25,18,5,.84);
      box-shadow:0 0 40px rgba(255,214,107,.25),0 16px 44px rgba(0,0,0,.45);
      animation:orbitCoachPulse .34s ease-in-out infinite alternate
    }
    .frame[data-orbit-coach="ready"] .orbitCoach .ocStep{color:#ffd66b}
    .frame[data-orbit-coach="ready"] .orbitCoach .ocTitle{color:#fff4c1;font-size:15px;text-shadow:0 0 17px rgba(255,214,107,.52)}
    .frame[data-orbit-coach="ready"] .orbitCoach .ocSub{color:#ffe9a7;font-weight:800}
    .frame[data-orbit-coach="ready"] #roleMeter{border-color:rgba(255,214,107,.72);box-shadow:0 0 24px rgba(255,214,107,.18)}
    .frame[data-orbit-coach="ready"] #roleMeterFill{background:linear-gradient(90deg,#ffd66b,#fff1ad)!important;box-shadow:0 0 18px rgba(255,214,107,.58)}
    @keyframes orbitCoachPulse{from{transform:translateY(0) scale(1)}to{transform:translateY(0) scale(1.022)}}
    @media(max-width:760px){
      .orbitCoach{right:8px;bottom:82px;width:min(245px,62%);padding:8px 9px}
      .orbitCoach .ocTitle{font-size:11px}.orbitCoach .ocSub{font-size:8px}.orbitCoach .ocFlow{display:none}
    }
  `;
  document.head.appendChild(style);

  const coach = document.createElement('div');
  coach.className = 'orbitCoach';
  coach.setAttribute('aria-live', 'polite');
  coach.innerHTML = `
    <span class="ocStep">FIONDA ORBITALE · 1/3</span>
    <strong class="ocTitle">CATTURA LA PALLA</strong>
    <span class="ocSub">Portala abbastanza vicino al nucleo dell’Attractor.</span>
    <span class="ocFlow"><i>CATCH</i> → <i>ROTATE</i> → <b>RELEASE</b></span>
  `;
  frame.appendChild(coach);

  const stepEl = coach.querySelector('.ocStep');
  const titleEl = coach.querySelector('.ocTitle');
  const subEl = coach.querySelector('.ocSub');
  let lastStage = 'off';

  function setStage(stage) {
    if (stage === lastStage) return;
    lastStage = stage;
    frame.dataset.orbitCoach = stage;
    if (stage === 'off') { coach.classList.remove('show'); return; }
    coach.classList.add('show');

    if (stage === 'catch') {
      stepEl.textContent = 'FIONDA ORBITALE · 1/3';
      titleEl.textContent = 'CATTURA LA PALLA';
      subEl.textContent = 'Portala abbastanza vicino al nucleo dell’Attractor.';
    } else if (stage === 'spin') {
      stepEl.textContent = 'FIONDA ORBITALE · 2/3';
      titleEl.textContent = '↻ RUOTA IL DITO';
      subEl.textContent = 'Fai cerchi attorno al nucleo. La barra SPIN sale con la velocità angolare.';
    } else {
      stepEl.textContent = 'FIONDA ORBITALE · 3/3';
      titleEl.textContent = '⚡ SUPERCHARGE';
      subEl.textContent = 'Molla il dito quando la freccia tangente punta dove vuoi tirare.';
      if (navigator.vibrate) navigator.vibrate(28);
    }
  }

  function tick() {
    const attractor = playerTypeLabel.textContent.trim().toUpperCase() === 'ATTRACTOR';
    const menuVisible = menu && getComputedStyle(menu).display !== 'none';
    const meter = roleMeterText.textContent.trim().toUpperCase();
    let stage = 'off';
    if (attractor && !menuVisible) {
      if (meter.includes('SUPERCHARGE')) stage = 'ready';
      else if (meter.includes('POWER')) stage = 'spin';
      else stage = 'catch';
    }
    setStage(stage);
    if (statusLine && stage === 'spin') statusLine.textContent = 'ATTRACTOR · Ruota il dito attorno al nucleo: più alta la velocità angolare, più potente il tiro. Rilascia sulla tangente.';
    if (statusLine && stage === 'ready') statusLine.textContent = 'SUPERCHARGE · La potenza è pronta: scegli l’angolo guardando la freccia e molla il dito.';
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
})();
