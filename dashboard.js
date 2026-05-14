/**
 * PQRS Dashboard - Lógica Frontend
 */

const CFG = window.PQRS_CONFIG;
const API = CFG.APPS_SCRIPT_URL;

// ============ ESTADO ============
let currentSlide = 0;
const slides = ['slide-geral', 'slide-ranking'];
let slideTimer = null;
let lastEventTimestamp = new Date().toISOString();
let celebrationQueue = [];
let isCelebrating = false;
let lastData = null;
let isPinned = false;

// ============ UTILS ============

/** Converte URL do Google Drive para formato que carrega em <img> */
function fixDriveUrl(url) {
  if (!url) return '';
  // Extrai o FILE_ID de qualquer formato comum
  let id = null;
  let match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);          // .../d/FILE_ID/...
  if (match) id = match[1];
  if (!id) {
    match = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);          // ...?id=FILE_ID
    if (match) id = match[1];
  }
  if (!id) return url; // não é Drive, retorna como está
  // Formato que funciona como image src (sem CORS bloqueado)
  return 'https://lh3.googleusercontent.com/d/' + id + '=w400-h400';
}

function fotoSVG(letra, cor) {
  const c = (cor || '#9ba3b8').replace('#', '%23');
  const l = (letra || '?').toUpperCase();
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect fill='%231c2138' width='200' height='200'/%3E%3Ctext x='100' y='130' font-size='90' font-family='Arial' text-anchor='middle' fill='${c}' font-weight='bold'%3E${l}%3C/text%3E%3C/svg%3E`;
}

function areaClass(area) {
  return (area && area.toLowerCase().includes('servidor')) ? 'area-serv' : 'area-trab';
}

function areaBadge(area) {
  const isServ = area && area.toLowerCase().includes('servidor');
  return isServ
    ? '<span class="rank-badge serv">Servidor Público</span>'
    : '<span class="rank-badge trab">Trabalhista</span>';
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ============ FETCH ============
async function fetchJSON(action, params = {}) {
  const url = new URL(API);
  url.searchParams.set('action', action);
  Object.keys(params).forEach(k => url.searchParams.set(k, params[k]));
  const res = await fetch(url.toString());
  return res.json();
}

// ============ ATUALIZAÇÃO DE DADOS ============
async function refreshData() {
  try {
    const data = await fetchJSON('data');
    if (data.error) {
      console.error('Erro do servidor:', data.error);
      showLoadingError('Erro do servidor: ' + data.error);
      return;
    }
    lastData = data;
    renderDashboard(data);
    aplicarConfigDinamica(data.config);
    document.getElementById('loading').classList.add('hidden');
    updateLastUpdate();
  } catch (err) {
    console.error('Erro ao buscar dados:', err);
    showLoadingError('Não foi possível conectar ao Apps Script.<br><br>' +
      'Possíveis causas:<br>' +
      '• Você não fez "Versão nova" no Implantar do Apps Script após atualizar o código<br>' +
      '• A URL no config.js está errada<br>' +
      '• Sem conexão com internet<br><br>' +
      'Erro técnico: ' + err.message);
  }
}

function showLoadingError(htmlMsg) {
  const loading = document.getElementById('loading');
  loading.innerHTML = `
    <div style="max-width:700px; text-align:center; padding:40px;">
      <h2 style="color:#ff5252; font-size:1.6rem; margin-bottom:20px;">⚠ Erro ao carregar</h2>
      <div style="color:#9ba3b8; line-height:1.8; text-align:left; background:#131829; padding:24px; border-radius:12px;">
        ${htmlMsg}
      </div>
      <button onclick="location.reload()" style="margin-top:24px; padding:12px 32px; background:linear-gradient(135deg,#00d9ff,#7c4dff); border:none; border-radius:8px; color:white; font-weight:700; cursor:pointer; font-size:1rem;">Tentar novamente</button>
    </div>
  `;
  loading.classList.remove('hidden');
}

/** Aplica configurações vindas do servidor (ex: intervalo de slide) sem recarregar a página */
function aplicarConfigDinamica(config) {
  if (!config) return;
  const novoIntervalo = Number(config.intervaloSlide);
  if (novoIntervalo > 0 && novoIntervalo !== CFG.SLIDE_DURATION_SECONDS) {
    console.log(`Intervalo de slide alterado: ${CFG.SLIDE_DURATION_SECONDS}s → ${novoIntervalo}s`);
    CFG.SLIDE_DURATION_SECONDS = novoIntervalo;
    // Reinicia a rotação para aplicar o novo intervalo imediatamente
    if (!isPinned && !isCelebrating) {
      stopSlideRotation();
      startSlideRotation();
    }
  }
}

function updateLastUpdate() {
  const el = document.getElementById('last-update');
  const now = new Date();
  el.textContent = 'Atualizado: ' + now.toLocaleTimeString('pt-BR');
}

// ============ RENDERIZAÇÃO ============
function renderDashboard(data) {
  // KPIs compactos (Slide 1 — linha de topo)
  setText('kpi-mes',    data.totais.contratos.mes);
  setText('kpi-semana', data.totais.contratos.semana);
  setText('kpi-dia',    data.totais.contratos.dia);
  setText('conv-mes',   data.totais.conversao.mes.toFixed(1) + '%');
  setText('leads-mes',  data.totais.leads.mes);
  setText('meta-dias',  data.meta.diasUteisRestantes);

  const diasUteis = Math.max(1, data.meta.diasUteisRestantes || 1);

  // ===== TRABALHISTA =====
  if (data.meta && data.meta.trabalhista) {
    const t = data.meta.trabalhista;
    setText('meta-trab-val', t.mensal);
    setText('trab-faltam', t.restantes);
    setText('trab-fechados', t.fechadosMes);
    setText('trab-meta-total', t.mensal);
    const pctT = Math.min(100, t.percentual || 0);
    setText('trab-pct', pctT.toFixed(0) + '%');
    const fillT = document.getElementById('trab-fill');
    if (fillT) fillT.style.width = pctT + '%';
    // ritmo necessário p/ área
    setText('trab-ritmo', (t.restantes / diasUteis).toFixed(1));
  }
  if (data.porArea && data.porArea.trabalhista) {
    const t = data.porArea.trabalhista;
    setText('trab-mes',    t.contratos.mes);
    setText('trab-semana', t.contratos.semana);
    setText('trab-dia',    t.contratos.dia);
    setText('trab-conv',   t.conversao.toFixed(1) + '%');
    setText('trab-leads',  t.leads.mes);
  }

  // ===== SERVIDOR =====
  if (data.meta && data.meta.servidor) {
    const s = data.meta.servidor;
    setText('meta-serv-val', s.mensal);
    setText('serv-faltam', s.restantes);
    setText('serv-fechados', s.fechadosMes);
    setText('serv-meta-total', s.mensal);
    const pctS = Math.min(100, s.percentual || 0);
    setText('serv-pct', pctS.toFixed(0) + '%');
    const fillS = document.getElementById('serv-fill');
    if (fillS) fillS.style.width = pctS + '%';
    setText('serv-ritmo', (s.restantes / diasUteis).toFixed(1));
  }
  if (data.porArea && data.porArea.servidor) {
    const s = data.porArea.servidor;
    setText('serv-mes',    s.contratos.mes);
    setText('serv-semana', s.contratos.semana);
    setText('serv-dia',    s.contratos.dia);
    setText('serv-conv',   s.conversao.toFixed(1) + '%');
    setText('serv-leads',  s.leads.mes);
  }

  // ===== Mini-ranking dentro de cada área =====
  renderMiniRank('trab-mini-rank-list', data.ranking, 'trab');
  renderMiniRank('serv-mini-rank-list', data.ranking, 'serv');

  // Ranking (Slide 2)
  renderRanking(data.ranking);
}

function renderMiniRank(containerId, ranking, areaKey) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const filtrado = ranking
    .filter(v => areaClass(v.area) === (areaKey === 'serv' ? 'area-serv' : 'area-trab'))
    .slice(0, 3);

  container.innerHTML = '';
  if (filtrado.length === 0) {
    container.innerHTML = '<div class="ami-empty">Nenhuma vendedora ativa nesta área</div>';
    return;
  }

  const medals = ['🥇', '🥈', '🥉'];
  const cor = areaKey === 'serv' ? '#ff6b35' : '#00d9ff';

  filtrado.forEach((v, i) => {
    const fotoUrl = fixDriveUrl(v.foto);
    const fb = fotoSVG(v.nome[0], cor);
    const row = document.createElement('div');
    row.className = 'ami-row';
    row.innerHTML = `
      <div class="ami-medal">${medals[i] || ''}</div>
      <img class="ami-foto" src="${fotoUrl}" data-fallback="${fb}" alt="${v.nome}">
      <div class="ami-nomewrap">
        <div class="ami-nome">${v.nome}</div>
        <div class="ami-conv">Conversão: <strong>${v.conversao.toFixed(1)}%</strong></div>
      </div>
      <div class="ami-num">${v.contratos.mes}</div>
    `;
    container.appendChild(row);
  });
  container.querySelectorAll('img').forEach(img => {
    img.onerror = () => { img.src = img.dataset.fallback; img.onerror = null; };
  });
}

function renderRanking(ranking) {
  const container = document.getElementById('ranking-list');
  container.innerHTML = '';

  ranking.forEach((v, i) => {
    const pos = i + 1;
    // Barra de progresso baseada na meta_dia × dias úteis do mês (≈ 22)
    const metaMes = (v.meta_dia || 2) * 22;
    const pct = Math.min(100, (v.contratos.mes / Math.max(1, metaMes)) * 100);
    const cls = areaClass(v.area);
    const cor = cls === 'area-serv' ? '#ff6b35' : '#00d9ff';
    const fotoUrl = fixDriveUrl(v.foto);
    const fotoFallback = fotoSVG(v.nome[0], cor);

    const item = document.createElement('div');
    item.className = 'ranking-item rank-' + pos + ' ' + cls;
    item.style.animationDelay = (i * 0.1) + 's';
    item.innerHTML = `
      <div class="rank-position">${pos}°</div>
      <img class="rank-foto" src="${fotoUrl}" data-fallback="${fotoFallback}" alt="${v.nome}">
      <div class="rank-info">
        <div class="rank-nome">
          ${v.nome} ${pos === 1 ? '👑' : ''}
          ${areaBadge(v.area)}
        </div>
        <div class="rank-stats">
          <span>Hoje: <strong>${v.contratos.dia}</strong></span>
          <span>Semana: <strong>${v.contratos.semana}</strong></span>
          <span>Mês: <strong class="rank-stat-mes">${v.contratos.mes}</strong></span>
          <span>Conversão: <strong>${v.conversao.toFixed(1)}%</strong></span>
        </div>
        <div class="rank-bar"><div class="rank-bar-fill" style="width:${pct}%"></div></div>
      </div>
      <div class="rank-numbers">
        <div class="rank-big">${v.contratos.mes}</div>
        <div class="rank-big-label">contratos<br>fechados no mês</div>
      </div>
    `;
    container.appendChild(item);
  });

  // Configurar fallback de imagem
  container.querySelectorAll('img').forEach(img => {
    img.onerror = () => { img.src = img.dataset.fallback; img.onerror = null; };
  });
}

function renderConversao(ranking) {
  const container = document.getElementById('conversao-list');
  container.innerHTML = '';

  // Ordenar por conversão (desc)
  const ordenado = [...ranking].sort((a, b) => b.conversao - a.conversao);
  const maxConv = Math.max(...ordenado.map(v => v.conversao), 5);

  ordenado.forEach(v => {
    const pct = (v.conversao / maxConv) * 100;
    const cls = areaClass(v.area);
    const cor = cls === 'area-serv' ? '#ff6b35' : '#00d9ff';
    const fotoUrl = fixDriveUrl(v.foto);
    const fotoFallback = fotoSVG(v.nome[0], cor);

    const item = document.createElement('div');
    item.className = 'conv-item ' + cls;
    item.innerHTML = `
      <img class="conv-foto" src="${fotoUrl}" data-fallback="${fotoFallback}" alt="${v.nome}">
      <div class="conv-info">
        <div class="conv-nome">${v.nome} ${areaBadge(v.area)}</div>
        <div class="conv-detail">${v.contratos.mes} contratos · ${v.leads.mes} leads</div>
        <div class="conv-bar"><div class="conv-bar-fill" style="width:${pct}%"></div></div>
      </div>
      <div class="conv-pct">${v.conversao.toFixed(1)}%</div>
    `;
    container.appendChild(item);
  });

  container.querySelectorAll('img').forEach(img => {
    img.onerror = () => { img.src = img.dataset.fallback; img.onerror = null; };
  });

  // Destaque
  const destaque = ordenado[0];
  if (destaque) {
    const cor = areaClass(destaque.area) === 'area-serv' ? '#ff6b35' : '#00d9ff';
    const fotoEl = document.getElementById('destaque-foto');
    fotoEl.src = fixDriveUrl(destaque.foto);
    fotoEl.onerror = () => { fotoEl.src = fotoSVG(destaque.nome[0], cor); fotoEl.onerror = null; };
    setText('destaque-nome', destaque.nome);
    setText('destaque-stat', destaque.conversao.toFixed(2) + '%');
  }
}

// ============ ROTAÇÃO DE SLIDES ============
function showSlide(index) {
  slides.forEach((id, i) => {
    document.getElementById(id).classList.toggle('active', i === index);
  });
  updateIndicator(index);
  currentSlide = index;
}

function nextSlide() {
  if (isCelebrating) return;
  showSlide((currentSlide + 1) % slides.length);
}

function prevSlide() {
  if (isCelebrating) return;
  showSlide((currentSlide - 1 + slides.length) % slides.length);
}

function startSlideRotation() {
  stopSlideRotation();
  if (isPinned) return;
  slideTimer = setInterval(nextSlide, CFG.SLIDE_DURATION_SECONDS * 1000);
}

function stopSlideRotation() {
  if (slideTimer) { clearInterval(slideTimer); slideTimer = null; }
}

function updateIndicator(active) {
  const container = document.getElementById('slide-indicator');
  container.innerHTML = '';
  slides.forEach((_, i) => {
    const dot = document.createElement('div');
    dot.className = 'dot' + (i === active ? ' active' : '');
    dot.onclick = () => { showSlide(i); resetTimerIfNotPinned(); };
    container.appendChild(dot);
  });
}

function resetTimerIfNotPinned() {
  if (!isPinned) { stopSlideRotation(); startSlideRotation(); }
}

function togglePin() {
  isPinned = !isPinned;
  const btn = document.getElementById('pin-btn');
  if (isPinned) {
    btn.classList.add('active');
    btn.querySelector('.pin-text').textContent = 'Fixado';
    stopSlideRotation();
  } else {
    btn.classList.remove('active');
    btn.querySelector('.pin-text').textContent = 'Fixar';
    startSlideRotation();
  }
}

// ============ DETECÇÃO DE EVENTOS (CELEBRAÇÃO) ============
async function checkEvents() {
  try {
    const data = await fetchJSON('events', { since: lastEventTimestamp });
    if (data.events && data.events.length > 0) {
      data.events.forEach(ev => celebrationQueue.push(ev));
      lastEventTimestamp = data.serverTime || new Date().toISOString();
      processCelebrationQueue();
    } else if (data.serverTime) {
      lastEventTimestamp = data.serverTime;
    }
  } catch (err) {
    console.error('Erro ao checar eventos:', err);
  }
}

async function processCelebrationQueue() {
  if (isCelebrating || celebrationQueue.length === 0) return;
  isCelebrating = true;
  const ev = celebrationQueue.shift();
  await celebrate(ev);
  isCelebrating = false;
  refreshData();
  setTimeout(processCelebrationQueue, 1000);
}

async function celebrate(ev) {
  stopSlideRotation();

  const cel = document.getElementById('celebracao');
  setText('cel-nome', ev.vendedor || 'Vendedor');
  setText('cel-negocio', ev.negocio || '');
  setText('cel-funil', ev.funil || '');

  // Total no mês
  let totalMes = '— no mês';
  if (lastData) {
    const v = lastData.ranking.find(x => x.nome === ev.vendedor);
    if (v) totalMes = (v.contratos.mes + 1) + ' no mês';
  }
  setText('cel-total', totalMes);

  // Foto
  const foto = document.getElementById('cel-foto');
  let fotoUrl = '';
  let fotoFallback = fotoSVG(ev.vendedor[0], '#ffd700');
  if (lastData) {
    const v = lastData.ranking.find(x => x.nome === ev.vendedor);
    if (v) fotoUrl = fixDriveUrl(v.foto);
  }
  foto.src = fotoUrl || fotoFallback;
  foto.onerror = () => { foto.src = fotoFallback; foto.onerror = null; };

  cel.classList.remove('hidden');

  // Tocar fanfarra + confete contínuo
  playFanfare();
  startConfetti();

  await new Promise(r => setTimeout(r, CFG.CELEBRATION_DURATION_SECONDS * 1000));

  stopConfetti();
  cel.classList.add('hidden');
  if (!isPinned) startSlideRotation();
}

// ============ FANFARRA COMEMORATIVA (Web Audio API, versão orquestrada) ============
function playFanfare() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // ====== MASTER CHAIN: Compressor → Destino ======
    const master = ctx.createDynamicsCompressor();
    master.threshold.value = -12;
    master.knee.value = 8;
    master.ratio.value = 6;
    master.attack.value = 0.003;
    master.release.value = 0.25;
    master.connect(ctx.destination);

    // ====== REVERB (impulse synthetic — sala orquestral) ======
    const reverb = ctx.createConvolver();
    const rate = ctx.sampleRate;
    const len = rate * 2.2;
    const rbuf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = rbuf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
      }
    }
    reverb.buffer = rbuf;

    const dry = ctx.createGain(); dry.gain.value = 0.7;
    const wet = ctx.createGain(); wet.gain.value = 0.4;
    dry.connect(master);
    wet.connect(reverb);
    reverb.connect(master);

    const send = (node) => { node.connect(dry); node.connect(wet); };

    // ====== BRASS (trompete/orquestra) — sawtooth+square com filtro LPF e ADSR ======
    function brass(freq, start, duration, vol) {
      const t = now + start;
      const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = freq;
      const o2 = ctx.createOscillator(); o2.type = 'square';   o2.frequency.value = freq; o2.detune.value = 7;
      const o3 = ctx.createOscillator(); o3.type = 'sawtooth'; o3.frequency.value = freq * 2; // brilho
      const og3 = ctx.createGain(); og3.gain.value = 0.18;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(freq * 3, t);
      filter.frequency.linearRampToValueAtTime(freq * 5, t + 0.05);
      filter.frequency.linearRampToValueAtTime(freq * 3, t + duration);
      filter.Q.value = 4;

      const g = ctx.createGain();
      // ADSR brass-like: attack rápido, decay leve, sustain firme, release suave
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.035);
      g.gain.linearRampToValueAtTime(vol * 0.78, t + 0.12);
      g.gain.setValueAtTime(vol * 0.78, t + Math.max(0.12, duration - 0.18));
      g.gain.exponentialRampToValueAtTime(0.001, t + duration);

      o1.connect(filter); o2.connect(filter); o3.connect(og3); og3.connect(filter);
      filter.connect(g);
      send(g);

      [o1, o2, o3].forEach(o => { o.start(t); o.stop(t + duration + 0.1); });
    }

    // ====== DRUM KICK (sub-bass com pitch envelope) ======
    function kick(start, vol) {
      const t = now + start;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(180, t);
      o.frequency.exponentialRampToValueAtTime(35, t + 0.18);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.connect(g); g.connect(dry);
      o.start(t); o.stop(t + 0.25);
    }

    // ====== SNARE (ruído filtrado + tom curto) ======
    function snare(start, vol) {
      const t = now + start;
      const bsz = (rate * 0.25) | 0;
      const b = ctx.createBuffer(1, bsz, rate);
      const d = b.getChannelData(0);
      for (let i = 0; i < bsz; i++) d[i] = Math.random() * 2 - 1;
      const n = ctx.createBufferSource(); n.buffer = b;
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1200;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      n.connect(f); f.connect(g); send(g);
      n.start(t); n.stop(t + 0.2);
    }

    // ====== CRASH CYMBAL (ruído branco com HPF + decay longo) ======
    function crash(start, vol) {
      const t = now + start;
      const bsz = (rate * 2.0) | 0;
      const b = ctx.createBuffer(1, bsz, rate);
      const d = b.getChannelData(0);
      for (let i = 0; i < bsz; i++) d[i] = (Math.random() * 2 - 1) * 0.6;
      const n = ctx.createBufferSource(); n.buffer = b;
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 5000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
      n.connect(f); f.connect(g); send(g);
      n.start(t); n.stop(t + 1.7);
    }

    // ====== BELL (sino metálico inarmônico) ======
    function bell(start, freq, vol) {
      const t = now + start;
      const partials = [
        { f: freq,         g: vol,        d: 1.8 },
        { f: freq * 2.76,  g: vol * 0.55, d: 0.9 },
        { f: freq * 5.40,  g: vol * 0.30, d: 0.5 },
      ];
      partials.forEach(p => {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = p.f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(p.g, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + p.d);
        o.connect(g); send(g);
        o.start(t); o.stop(t + p.d + 0.05);
      });
    }

    // ====== MULTIDÃO (pink noise filtrado, envelope longo) ======
    function crowd(start, duration, vol) {
      const t = now + start;
      const bsz = (rate * duration) | 0;
      const b = ctx.createBuffer(1, bsz, rate);
      const d = b.getChannelData(0);
      let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
      for (let i = 0; i < bsz; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886*b0 + w*0.0555179;
        b1 = 0.99332*b1 + w*0.0750759;
        b2 = 0.96900*b2 + w*0.1538520;
        b3 = 0.86650*b3 + w*0.3104856;
        b4 = 0.55000*b4 + w*0.5329522;
        b5 = -0.7616*b5 - w*0.0168980;
        d[i] = (b0+b1+b2+b3+b4+b5+b6+w*0.5362)*0.11;
        b6 = w*0.115926;
      }
      const n = ctx.createBufferSource(); n.buffer = b;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.7;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.35);
      g.gain.linearRampToValueAtTime(vol * 0.85, t + duration - 0.6);
      g.gain.exponentialRampToValueAtTime(0.001, t + duration);
      n.connect(f); f.connect(g); send(g);
      n.start(t); n.stop(t + duration);
    }

    // ============================================================
    // ORQUESTRAÇÃO — Fanfarra Olímpica
    // ============================================================
    // Notas (Hz): C4=261.63 · C5=523.25 · E5=659.25 · G5=783.99 · C6=1046.5 · E6=1318.5 · G6=1567.98

    // [0.00] Tarola/snare roll subindo (3 hits em crescendo)
    snare(0.00, 0.18); snare(0.10, 0.22); snare(0.20, 0.28);

    // [0.35] Bar 1: três notas de impulso (Da-Da-Da)
    brass(523.25, 0.35, 0.17, 0.32);   // C5
    brass(659.25, 0.52, 0.17, 0.34);   // E5
    brass(783.99, 0.69, 0.17, 0.36);   // G5

    // [0.90] PRIMEIRO ACORDE FORTE (DAAA!) com kick + crash + acorde C maior alto
    kick(0.90, 0.85); snare(0.90, 0.4); crash(0.90, 0.55);
    brass(1046.5, 0.90, 1.25, 0.42);   // C6
    brass(783.99, 0.90, 1.25, 0.32);   // G5
    brass(659.25, 0.90, 1.25, 0.32);   // E5
    brass(261.63, 0.90, 1.25, 0.45);   // C4 (baixo)

    // [2.30] Bar 2: subida (Da-Da-Da mais agudo)
    brass(659.25, 2.30, 0.17, 0.34);   // E5
    brass(783.99, 2.47, 0.17, 0.36);   // G5
    brass(1046.5, 2.64, 0.17, 0.38);   // C6

    // [2.85] ACORDE FINAL ÉPICO (E maior + bass), kick + crash forte
    kick(2.85, 1.0); snare(2.85, 0.5); crash(2.85, 0.7);
    brass(1318.5, 2.85, 2.0, 0.5);     // E6 (topo)
    brass(1046.5, 2.85, 2.0, 0.42);    // C6
    brass(783.99, 2.85, 2.0, 0.36);    // G5
    brass(523.25, 2.85, 2.0, 0.36);    // C5
    brass(261.63, 2.85, 2.0, 0.48);    // C4 (baixo profundo)

    // [3.10] Sinos brilhantes (sparkle) descendo
    bell(3.10, 2637.02, 0.38);  // E7
    bell(3.45, 2093.00, 0.34);  // C7
    bell(3.80, 1567.98, 0.30);  // G6

    // [2.95] MULTIDÃO COMEMORA (4 segundos)
    crowd(2.95, 4.0, 0.35);

    // [4.20] Kick final p/ fechar
    kick(4.20, 0.6); crash(4.20, 0.4);

  } catch (e) {
    console.error('Erro ao tocar fanfarra:', e);
  }
}

// ============ CONFETE ============
let confettiAnimId = null;
let confettiPieces = [];

function startConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const colors = ['#ffd700', '#00d9ff', '#7c4dff', '#00e676', '#ff5252', '#ff9800', '#ff6b35'];
  confettiPieces = [];
  for (let i = 0; i < 250; i++) {
    confettiPieces.push({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 5,
      vy: 2 + Math.random() * 5,
      size: 5 + Math.random() * 10,
      color: colors[Math.floor(Math.random() * colors.length)],
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 0.25,
    });
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    confettiPieces.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vrot;
      if (p.y > canvas.height) {
        p.y = -20;
        p.x = Math.random() * canvas.width;
      }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.5);
      ctx.restore();
    });
    confettiAnimId = requestAnimationFrame(draw);
  }
  draw();
}

function stopConfetti() {
  if (confettiAnimId) cancelAnimationFrame(confettiAnimId);
  const canvas = document.getElementById('confetti-canvas');
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

// ============ INIT ============
async function init() {
  if (!API || API.includes('COLE_AQUI')) {
    document.getElementById('loading').innerHTML = `
      <div style="max-width:600px; text-align:center; padding:40px;">
        <h2 style="color:#ff5252; font-size:1.8rem; margin-bottom:16px;">⚠ URL do Apps Script não configurada</h2>
        <p style="color:#9ba3b8; line-height:1.6; margin-bottom:20px;">Configure o config.js antes de usar.</p>
      </div>`;
    return;
  }

  await refreshData();
  showSlide(0);
  startSlideRotation();

  setInterval(refreshData, CFG.REFRESH_DATA_SECONDS * 1000);
  setInterval(checkEvents, CFG.CHECK_EVENTS_SECONDS * 1000);

  // Controles
  document.getElementById('pin-btn').onclick = togglePin;
  document.getElementById('prev-btn').onclick = () => { prevSlide(); resetTimerIfNotPinned(); };
  document.getElementById('next-btn').onclick = () => { nextSlide(); resetTimerIfNotPinned(); };

  // Atalhos
  document.addEventListener('keydown', e => {
    if (e.key === 't' || e.key === 'T') {
      celebrationQueue.push({
        vendedor: lastData && lastData.ranking[0] ? lastData.ranking[0].nome : 'Bella Rosa',
        negocio: 'TESTE - Contrato Simulado',
        funil: '1. Trabalhista',
        valor: 5000,
      });
      processCelebrationQueue();
    }
    if (e.key === 'n' || e.key === 'N') { nextSlide(); resetTimerIfNotPinned(); }
    if (e.key === 'p' || e.key === 'P') { prevSlide(); resetTimerIfNotPinned(); }
    if (e.key === 'f' || e.key === 'F') togglePin();
    if (e.key === ' ') { e.preventDefault(); togglePin(); }
  });
}

init();
