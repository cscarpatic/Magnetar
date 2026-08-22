(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const frame = $('frame');
  const pulseBtn = $('pulseBtn');
  const roleMeterText = $('roleMeterText');
  const playerTypeLabel = $('playerTypeLabel');
  const statusLine = $('statusLine');
  const menu = $('menu');

  if (!frame || !pulseBtn || !roleMeterText || !playerTypeLabel) return;

  const style = document.createElement('style');
  style.textContent = `
    .superchargeCoach{
      position:absolute;right:18px;bottom:104px;z-index:11;width:min(285px,36%);
      padding:10px 12px;border:1px solid rgba(93,231,255,.24);border-radius:13px;
      background:rgba(2,8,18,.78);backdrop-filter:blur(12px);pointer-events:none;
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
    .swipeRing{position:absolute;inset:-11px;border-radius:50%;border:2px solid transparent;pointer-events:none;opacity:0;transform:scale(.94);transition:.16s ease}

    .frame[data-attractor-coach="catch"] .superchargeCoach{border-color:rgba(93,231,255,.30)}
    .frame[data-attractor-coach="catch"] .superchargeCoach .scTitle{color:#9beeff}

    .frame[data-attractor-coach="swipe"] .superchargeCoach{
      border-color:rgba(255,214,107,.78);background:rgba(25,18,5,.80);
      box-shadow:0 0 38px rgba(255,214,107,.20),0 16px 44px rgba(0,0,0,.45)
    }
    .frame[data-attractor-coach="swipe"] .superchargeCoach .scStep{color:#ffd66b}
    .frame[data-attractor-coach="swipe"] .superchargeCoach .scTitle{color:#fff4c1;font-size:15px;text-shadow:0 0 17px rgba(255,214,107,.42)}
    .frame[data-attractor-coach="swipe"] .superchargeCoach .scSub{color:#ffe9a7;font-weight:800}
    .frame[data-attractor-coach="swipe"] .swipeRing{
      opacity:1;border:3px solid rgba(255,214,107,.78);box-shadow:0 0 24px rgba(255,214,107,.48),inset 0 0 18px rgba(255,214,107,.12);
      transform:scale(1.08);animation:swipeReadyRing .42s ease-in-out infinite alternate
    }
    .frame[data-attractor-coach="swipe"] .pulseButton{
      border-color:#ffd66b!important;color:#fff6ce!important;box-shadow:0 0 30px rgba(255,214,107,.35),inset 0 0 22px rgba(255,214,107,.14)!important
    }
    @keyframes swipeReadyRing{from{transform:scale(1.02);filter:brightness(1)}to{transform:scale(1.12);filter:brightness(1.35)}}
    @media(max-width:760px){
      .superchargeCoach{right:8px;bottom:82px;width:min(230px,60%);padding:8px 9px}
      .superchargeCoach .scTitle{font-size:11px}.superchargeCoach .scSub{font-size:8px}.superchargeCoach .scFlow{display:none}
    }
  `;
  document.head.appendChild(style);

  const coach = document.createElement('div');
  coach.className = 'superchargeCoach';
  coach.setAttribute('aria-live', 'polite');
  coach.innerHTML = `
    <span class="scStep">ATTRACTOR · 1/2</span>
    <strong class="scTitle">CATTURA LA PALLA</strong>
    <span class="scSub">Portala abbastanza vicino al tuo nucleo.</span>
    <span class="scFlow"><i>CATCH</i> → <b>SWIPE + RELEASE</b></span>
  `;
  frame.appendChild(coach);

  const ring = document.createElement('span');
  ring.className = 'swipeRing';
  pulseBtn.appendChild(ring);

  const stepEl = coach.querySelector('.scStep');
  const titleEl = coach.querySelector('.scTitle');
  const subEl = coach.querySelector('.scSub');
  let lastStage = 'off';

  function setStage(stage) {
    if (stage === lastStage) return;
    lastStage = stage;
    frame.dataset.attractorCoach = stage;

    if (stage === 'off') {
      coach.classList.remove('show');
      return;
    }
    coach.classList.add('show');

    if (stage === 'catch') {
      stepEl.textContent = 'ATTRACTOR · 1/2';
      titleEl.textContent = 'CATTURA LA PALLA';
      subEl.textContent = 'Portala abbastanza vicino al tuo nucleo.';
    } else {
      stepEl.textContent = 'ATTRACTOR · 2/2';
      titleEl.textContent = '↢ SWIPE E RILASCIA';
      subEl.textContent = 'Direzione = swipe · Più rapido il gesto, più potente il tiro.';
    }
  }

  function tick() {
    const attractor = playerTypeLabel.textContent.trim().toUpperCase() === 'ATTRACTOR';
    const menuVisible = menu && getComputedStyle(menu).display !== 'none';
    const meter = roleMeterText.textContent.trim().toUpperCase();

    let stage = 'off';
    if (attractor && !menuVisible) stage = meter.includes('SWIPE') ? 'swipe' : 'catch';
    setStage(stage);

    if (stage === 'swipe' && statusLine) {
      statusLine.textContent = 'ATTRACTOR · Fai swipe nella direzione del tiro e rilascia. La velocità del gesto decide la potenza.';
    }
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
})();
