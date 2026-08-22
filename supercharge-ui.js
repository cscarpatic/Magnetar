(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const frame = $('frame');
  const pulseBtn = $('pulseBtn');
  const pulseState = $('pulseState');
  const pulseHint = $('pulseHint');
  const pulseDock = $('pulseDock');
  const roleMeter = $('roleMeter');
  const roleMeterText = $('roleMeterText');
  const roleMeterFill = $('roleMeterFill');
  const playerTypeLabel = $('playerTypeLabel');
  const statusLine = $('statusLine');
  const menu = $('menu');

  if (!frame || !pulseBtn || !pulseState || !pulseHint || !roleMeterText || !playerTypeLabel) return;

  const style = document.createElement('style');
  style.textContent = `
    .superchargeCoach{
      position:absolute;right:18px;bottom:104px;z-index:11;width:min(270px,34%);
      padding:10px 12px;border:1px solid rgba(93,231,255,.22);border-radius:13px;
      background:rgba(2,8,18,.76);backdrop-filter:blur(12px);pointer-events:none;
      opacity:0;transform:translateY(8px);transition:opacity .16s ease,transform .16s ease,border-color .16s ease,box-shadow .16s ease;
      box-shadow:0 12px 38px rgba(0,0,0,.34)
    }
    .superchargeCoach.show{opacity:1;transform:translateY(0)}
    .superchargeCoach .scStep{display:block;color:#8190ae;font-size:8px;font-weight:900;letter-spacing:.18em;margin-bottom:3px}
    .superchargeCoach .scTitle{display:block;color:#eafaff;font-size:13px;font-weight:950;letter-spacing:.06em}
    .superchargeCoach .scSub{display:block;margin-top:3px;color:#8797b7;font-size:9px;line-height:1.35}
    .superchargeCoach .scFlow{display:flex;align-items:center;gap:4px;margin-top:8px;font-size:7px;font-weight:900;letter-spacing:.08em;color:#657592}
    .superchargeCoach .scFlow i{font-style:normal;padding:3px 5px;border-radius:999px;border:1px solid rgba(255,255,255,.08)}
    .superchargeCoach .scFlow b{color:#ffd66b}
    .superchargeRing{position:absolute;inset:-11px;border-radius:50%;border:2px solid transparent;pointer-events:none;opacity:0;transform:scale(.92);transition:.16s ease}

    .frame[data-supercharge="catch"] .superchargeCoach{border-color:rgba(93,231,255,.28)}
    .frame[data-supercharge="catch"] .superchargeCoach .scTitle{color:#9beeff}
    .frame[data-supercharge="catch"] .superchargeRing{opacity:.16;border-color:rgba(93,231,255,.35);transform:scale(1)}

    .frame[data-supercharge="charging"] .superchargeCoach{border-color:rgba(255,214,107,.36);box-shadow:0 12px 38px rgba(0,0,0,.34),0 0 28px rgba(255,214,107,.07)}
    .frame[data-supercharge="charging"] .superchargeCoach .scTitle{color:#ffe69a}
    .frame[data-supercharge="charging"] .superchargeRing{opacity:.55;border-color:rgba(255,214,107,.48);border-top-color:#ffd66b;transform:scale(1);animation:scSpin .9s linear infinite}
    .frame[data-supercharge="charging"] #roleMeterFill{background:linear-gradient(90deg,#5de7ff,#ffd66b);box-shadow:0 0 13px rgba(255,214,107,.24)}

    .frame[data-supercharge="ready"] .superchargeCoach{border-color:rgba(255,214,107,.78);background:rgba(25,18,5,.78);box-shadow:0 0 38px rgba(255,214,107,.24),0 16px 44px rgba(0,0,0,.45);animation:scCoachPulse .34s ease-in-out infinite alternate}
    .frame[data-supercharge="ready"] .superchargeCoach .scStep{color:#ffd66b}
    .frame[data-supercharge="ready"] .superchargeCoach .scTitle{color:#fff4c1;font-size:15px;text-shadow:0 0 17px rgba(255,214,107,.48)}
    .frame[data-supercharge="ready"] .superchargeCoach .scSub{color:#ffe9a7;font-weight:800}
    .frame[data-supercharge="ready"] .superchargeRing{opacity:1;border:3px solid rgba(255,214,107,.8);box-shadow:0 0 24px rgba(255,214,107,.58),inset 0 0 18px rgba(255,214,107,.14);transform:scale(1.08);animation:scReadyRing .42s ease-in-out infinite alternate}
    .frame[data-supercharge="ready"] .pulseButton{border-color:#ffd66b!important;color:#fff6ce!important;box-shadow:0 0 38px rgba(255,214,107,.5),inset 0 0 26px rgba(255,214,107,.19)!important;background:radial-gradient(circle,rgba(255,214,107,.28),rgba(38,25,5,.92) 58%,rgba(9,7,2,.98))!important}
    .frame[data-supercharge="ready"] .pulseIcon,.frame[data-supercharge="ready"] .pulseMeta strong{color:#ffd66b!important;text-shadow:0 0 12px rgba(255,214,107,.5)}
    .frame[data-supercharge="ready"] #roleMeter{border-color:rgba(255,214,107,.55);box-shadow:0 0 24px rgba(255,214,107,.15)}
    .frame[data-supercharge="ready"] #roleMeterFill{width:100%!important;background:linear-gradient(90deg,#ffd66b,#fff1ad)!important;box-shadow:0 0 18px rgba(255,214,107,.55)}
    .frame[data-supercharge="ready"] .playerTag strong{color:#ffd66b;text-shadow:0 0 14px rgba(255,214,107,.55)}

    @keyframes scSpin{to{transform:scale(1) rotate(360deg)}}
    @keyframes scReadyRing{from{transform:scale(1.02);filter:brightness(1)}to{transform:scale(1.13);filter:brightness(1.45)}}
    @keyframes scCoachPulse{from{transform:translateY(0) scale(1)}to{transform:translateY(0) scale(1.025)}}
    @media(max-width:760px){
      .superchargeCoach{right:8px;bottom:82px;width:min(220px,56%);padding:8px 9px}
      .superchargeCoach .scTitle{font-size:11px}.superchargeCoach .scSub{font-size:8px}.superchargeCoach .scFlow{display:none}
    }
  `;
  document.head.appendChild(style);

  const coach = document.createElement('div');
  coach.id = 'superchargeCoach';
  coach.className = 'superchargeCoach';
  coach.setAttribute('aria-live', 'polite');
  coach.innerHTML = `
    <span class="scStep">SUPERCHARGE · 1/3</span>
    <strong class="scTitle">CATTURA LA PALLA</strong>
    <span class="scSub">Portala dentro il campo dell’Attractor.</span>
    <span class="scFlow"><i>CATCH</i> → <i>CHARGE</i> → <b>PULSE!</b></span>
  `;
  frame.appendChild(coach);

  const ring = document.createElement('span');
  ring.className = 'superchargeRing';
  pulseBtn.appendChild(ring);

  const stepEl = coach.querySelector('.scStep');
  const titleEl = coach.querySelector('.scTitle');
  const subEl = coach.querySelector('.scSub');

  let lastStage = 'off';
  let audioCtx = null;

  function armAudio() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (_) {}
  }
  window.addEventListener('pointerdown', armAudio, { once: true, passive: true });
  window.addEventListener('keydown', armAudio, { once: true });

  function readyCue() {
    if (navigator.vibrate) navigator.vibrate(35);
    try {
      if (!audioCtx || audioCtx.state !== 'running') return;
      const now = audioCtx.currentTime;
      [660, 990].forEach((freq, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(freq, now + i * .045);
        g.gain.setValueAtTime(.0001, now + i * .045);
        g.gain.exponentialRampToValueAtTime(.028, now + i * .045 + .01);
        g.gain.exponentialRampToValueAtTime(.0001, now + i * .045 + .12);
        o.connect(g).connect(audioCtx.destination);
        o.start(now + i * .045); o.stop(now + i * .045 + .13);
      });
    } catch (_) {}
  }

  function setStage(stage) {
    if (stage === lastStage) return;
    lastStage = stage;
    frame.dataset.supercharge = stage;

    if (stage === 'off') {
      coach.classList.remove('show');
      return;
    }
    coach.classList.add('show');

    if (stage === 'catch') {
      stepEl.textContent = 'SUPERCHARGE · 1/3';
      titleEl.textContent = 'CATTURA LA PALLA';
      subEl.textContent = 'Portala dentro il campo dell’Attractor.';
    } else if (stage === 'charging') {
      stepEl.textContent = 'SUPERCHARGE · 2/3';
      titleEl.textContent = 'PALLA CATTURATA · CARICA';
      subEl.textContent = 'Non premere ancora. Aspetta che tutto diventi ORO.';
    } else if (stage === 'ready') {
      stepEl.textContent = 'SUPERCHARGE · 3/3';
      titleEl.textContent = '⚡ SUPERCHARGE READY';
      subEl.textContent = 'PULSE ORA! · SPAZIO / TAP';
      readyCue();
    }
  }

  function tick() {
    const attractor = playerTypeLabel.textContent.trim().toUpperCase() === 'ATTRACTOR';
    const menuVisible = menu && getComputedStyle(menu).display !== 'none';
    const meter = roleMeterText.textContent.trim().toUpperCase();
    const pulse = pulseState.textContent.trim().toUpperCase();

    let stage = 'off';
    if (attractor && !menuVisible) {
      if (meter.includes('PERFECT') || pulse.includes('PERFECT')) stage = 'ready';
      else if (meter.includes('AIM') || pulse.includes('AIM') || meter.includes('CHARG')) stage = 'charging';
      else stage = 'catch';
    }

    setStage(stage);

    // Rinomina gli stati tecnici con parole che spiegano immediatamente cosa fare.
    if (stage === 'charging') {
      pulseState.textContent = 'CHARGING';
      pulseHint.textContent = 'NON PREMERE';
      if (statusLine) statusLine.textContent = 'SUPERCHARGE 2/3 · Pallina catturata: aspetta l’anello ORO, poi premi PULSE.';
    } else if (stage === 'ready') {
      pulseState.textContent = 'SUPERCHARGE!';
      pulseHint.textContent = 'PULSE ORA!';
      if (statusLine) statusLine.textContent = 'SUPERCHARGE 3/3 · ORA! Premi SPAZIO / PULSE per il Perfect Slingshot.';
    } else if (stage === 'catch') {
      if (statusLine) statusLine.textContent = 'SUPERCHARGE 1/3 · Porta la pallina dentro il campo dell’Attractor per catturarla.';
    }

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
})();
