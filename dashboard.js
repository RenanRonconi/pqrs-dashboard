/**
 * PQRS Dashboard - Lógica Frontend
 */

const CFG = window.PQRS_CONFIG;
const API = CFG.APPS_SCRIPT_URL;

// ============ ESTADO ============
let currentSlide = 0;
const slides = ['slide-geral', 'slide-ranking', 'slide-conversao'];
let slideTimer = null;
let lastEventTimestamp = new Date().toISOString();
let celebrationQueue = [];
let isCelebrating = false;
let lastData = null;
let isPinned = false;

// Whitelist de funis em que a celebração pode acontecer.
// Defesa em camadas: o backend já filtra, mas revalidamos aqui para garantir
// que nenhum evento de funil indevido (ex.: "1. Jurídico Trabalhista") dispare a animação.
const FUNIS_CELEBRACAO_PERMITIDOS = ['1. Trabalhista', '2. Servidor Público', '2. Servidor Público - Indicação'];

// Pré-carrega o MP3 de celebração para evitar delay na hora do evento
let _celebracaoAudio = null;
function _preloadCelebracao() {
  _celebracaoAudio = new Audio('celebracao.mp3');
  _celebracaoAudio.load();
}
window.addEventListener('load', _preloadCelebracao);

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

/**
 * Nome exibido na tela. O campo `nome` continua sendo o do Pipedrive (usado para
 * casar os contratos); `nome_exibicao` é o nome opcional configurado para mostrar
 * no dashboard quando a conta do Pipedrive é de outra pessoa.
 */
function nomeDisp(v) {
  if (!v) return '';
  const n = (v.nome_exibicao || '').trim();
  return n || v.nome || '';
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

/** Aplica configurações vindas do servidor sem recarregar a página */
function aplicarConfigDinamica(config) {
  if (!config) return;
  let changed = false;

  const novoDash = Number(config.intervaloDashboard);
  if (novoDash > 0 && novoDash !== CFG.DASHBOARD_DURATION_SECONDS) {
    CFG.DASHBOARD_DURATION_SECONDS = novoDash;
    changed = true;
  }
  const novoRank = Number(config.intervaloRanking);
  if (novoRank > 0 && novoRank !== CFG.RANKING_DURATION_SECONDS) {
    CFG.RANKING_DURATION_SECONDS = novoRank;
    changed = true;
  }
  // Retrocompatibilidade: intervaloSlide aplica a ambos se os individuais não vieram
  const novoIntervalo = Number(config.intervaloSlide);
  if (novoIntervalo > 0 && !novoDash && !novoRank) {
    if (novoIntervalo !== CFG.DASHBOARD_DURATION_SECONDS) { CFG.DASHBOARD_DURATION_SECONDS = novoIntervalo; changed = true; }
    if (novoIntervalo !== CFG.RANKING_DURATION_SECONDS)   { CFG.RANKING_DURATION_SECONDS   = novoIntervalo; changed = true; }
  }

  if (changed && !isPinned && !isCelebrating) {
    stopSlideRotation();
    startSlideRotation();
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

  // Ranking (Slide 2) — alterna entre cards e horizontal
  // Prioridade: backend config (rankingLayout) > CFG local > 'cards'
  const layoutEscolhido = (data.config && data.config.rankingLayout)
                       || CFG.RANKING_LAYOUT
                       || 'cards';
  if (layoutEscolhido === 'horizontal') {
    document.getElementById('ranking-list').className = 'ranking-list';
    renderRanking(data.ranking);
  } else {
    renderRankingCards(data.ranking);
  }

  // Ranking por conversão (Slide 3)
  renderConversao(data.ranking);
}

function renderMiniRank(containerId, ranking, areaKey) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Cada linha da planilha (nome + área) vira uma entrada distinta no ranking,
  // então basta filtrar pela área cadastrada do entry para isolar cada card.
  const filtrado = ranking
    .filter(v => areaClass(v.area) === (areaKey === 'serv' ? 'area-serv' : 'area-trab'))
    .sort((a, b) => b.contratos.mes - a.contratos.mes)
    .slice(0, 4);

  container.innerHTML = '';
  if (filtrado.length === 0) {
    container.innerHTML = '<div class="ami-empty">Nenhuma vendedora ativa nesta área</div>';
    return;
  }

  const medals = ['🥇', '🥈', '🥉', '4º'];
  const cor = areaKey === 'serv' ? '#ff6b35' : '#00d9ff';

  filtrado.forEach((v, i) => {
    const nome = nomeDisp(v);
    const fotoUrl = fixDriveUrl(v.foto);
    const fb = fotoSVG(nome[0] || '?', cor);
    const streakHtml = (v.streak || 0) >= 2
      ? `<span class="ami-streak">🔥${v.streak}</span>` : '';
    const row = document.createElement('div');
    row.className = 'ami-row';
    row.innerHTML = `
      <div class="ami-medal">${medals[i] || ''}</div>
      <img class="ami-foto" src="${fotoUrl}" data-fallback="${fb}" alt="${nome}">
      <div class="ami-nomewrap">
        <div class="ami-nome">${nome} ${streakHtml}</div>
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

// ─── Helpers de gamificação ───
function paceStatus(contratosMes, metaMes, diasDecorridos, diasTotal) {
  if (!metaMes || !diasTotal) return { tag: '—', cls: 'pace-neutral', label: '—' };
  const esperado = (metaMes / diasTotal) * Math.max(1, diasDecorridos);
  const ratio = contratosMes / Math.max(0.0001, esperado);
  if (ratio >= 1.00) return { tag: '🟢', cls: 'pace-green',  label: 'No ritmo' };
  if (ratio >= 0.80) return { tag: '🟡', cls: 'pace-yellow', label: 'Atenção'  };
  return                    { tag: '🔴', cls: 'pace-red',    label: 'Perigo'   };
}

/** Pace de conversão: compara conversão% do vendedor com a meta de conversão% */
function convPaceStatus(conversao, metaConv) {
  if (!metaConv) return { tag: '—', cls: 'pace-neutral' };
  const ratio = conversao / metaConv;
  if (ratio >= 1.00) return { tag: '🟢 No ritmo',  cls: 'pace-green'  };
  if (ratio >= 0.80) return { tag: '🟡 Atenção',   cls: 'pace-yellow' };
  return                    { tag: '🔴 Perigo',    cls: 'pace-red'    };
}

function badgesVendedora(v, pos) {
  const out = [];
  // (a coroa do #1 fica como faixa "LÍDER" no card; aqui só conquistas comuns)
  if (v.contratos.dia >= 3)                        out.push({ ico: '⚡', tip: 'Relâmpago — 3+ hoje' });
  if (v.contratos.dia >= (v.meta_dia || 2))        out.push({ ico: '🎯', tip: 'Meta do dia batida' });
  if (v.meta_mes > 0 && v.contratos.mes >= v.meta_mes) out.push({ ico: '🏆', tip: 'Meta do mês batida' });
  if ((v.streak || 0) >= 5)                        out.push({ ico: '🔥', tip: 'Em chamas — ' + v.streak + ' dias' });
  return out;
}

function setaPosicao(posAtual, posAnterior) {
  if (posAnterior == null) return { txt: 'NEW', cls: 'arr-new' };
  const delta = posAnterior - posAtual; // positivo = subiu
  if (delta > 0)  return { txt: '▲' + delta, cls: 'arr-up'   };
  if (delta < 0)  return { txt: '▼' + (-delta), cls: 'arr-down' };
  return            { txt: '◆',  cls: 'arr-same' };
}

function renderRanking(ranking) {
  const container = document.getElementById('ranking-list');
  container.innerHTML = '';

  // Dias úteis para cálculo de pace (vêm do backend, fallback p/ heurística local)
  const meta = (lastData && lastData.meta) || {};
  const diasTotal     = meta.diasUteisTotal     || 22;
  const diasDecorrido = meta.diasUteisDecorridos || Math.max(1, diasTotal - (meta.diasUteisRestantes || 0));

  ranking.forEach((v, i) => {
    const pos = i + 1;
    const metaMes = v.meta_mes || ((v.meta_dia || 2) * 22);
    const pct = Math.min(100, (v.contratos.mes / Math.max(1, metaMes)) * 100);
    const nome = nomeDisp(v);
    const cls = areaClass(v.area);
    const cor = cls === 'area-serv' ? '#ff6b35' : '#00d9ff';
    const fotoUrl = fixDriveUrl(v.foto);
    const fotoFallback = fotoSVG(nome[0] || '?', cor);

    const pace  = paceStatus(v.contratos.mes, metaMes, diasDecorrido, diasTotal);
    const badges = badgesVendedora(v, pos);
    const arrow = setaPosicao(pos, v.posicao_anterior);

    // Chase indicator (a quantos contratos está de alcançar/ultrapassar quem está acima)
    let chase = '';
    if (pos > 1) {
      const acima = ranking[i - 1];
      const diff = acima.contratos.mes - v.contratos.mes;
      if (diff === 0)      chase = `Empatada com <strong>${nomeDisp(acima)}</strong> — próximo contrato assume o ${pos - 1}º`;
      else if (diff === 1) chase = `A <strong>1</strong> de alcançar <strong>${nomeDisp(acima)}</strong>`;
      else                 chase = `A <strong>${diff}</strong> de ultrapassar <strong>${nomeDisp(acima)}</strong>`;
    } else {
      const abaixo = ranking[i + 1];
      if (abaixo) {
        const gap = v.contratos.mes - abaixo.contratos.mes;
        chase = gap > 0
          ? `<strong>${gap}</strong> à frente de <strong>${nomeDisp(abaixo)}</strong>`
          : `<strong>${nomeDisp(abaixo)}</strong> empatada — defenda o topo!`;
      }
    }

    const streakHtml = (v.streak || 0) >= 2
      ? `<span class="rank-streak" title="${v.streak} dia(s) seguido(s) fechando">🔥${v.streak}</span>`
      : '';

    const badgesHtml = badges.map(b =>
      `<span class="rank-badge-ico" title="${b.tip}">${b.ico}</span>`
    ).join('');

    const item = document.createElement('div');
    item.className = 'ranking-item rank-' + pos + ' ' + cls;
    item.style.animationDelay = (i * 0.1) + 's';
    item.innerHTML = `
      <div class="rank-position">
        <span class="rank-pos-num">${pos}°</span>
        <span class="rank-arrow ${arrow.cls}">${arrow.txt}</span>
      </div>
      <img class="rank-foto" src="${fotoUrl}" data-fallback="${fotoFallback}" alt="${nome}">
      <div class="rank-info">
        <div class="rank-nome-line">
          <span class="rank-nome">${nome}</span>
          ${streakHtml}
          ${badgesHtml}
          ${areaBadge(v.area)}
        </div>
        <div class="rank-chase">${chase}</div>
        <div class="rank-stats">
          <span>Hoje: <strong>${v.contratos.dia}</strong>/${v.meta_dia || 2}</span>
          <span>Semana: <strong>${v.contratos.semana}</strong></span>
          <span>Mês: <strong class="rank-stat-mes">${v.contratos.mes}</strong>/${metaMes}</span>
          <span>Conversão: <strong>${v.conversao.toFixed(1)}%</strong></span>
          <span class="rank-pace ${pace.cls}" title="${pace.label}">${pace.tag} ${pace.label}</span>
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

  container.querySelectorAll('img').forEach(img => {
    img.onerror = () => { img.src = img.dataset.fallback; img.onerror = null; };
  });
}

// ============ RANKING EM CARDS (layout estilo cartas) ============
function renderRankingCards(ranking) {
  const container = document.getElementById('ranking-list');
  container.innerHTML = '';
  container.className = 'ranking-cards-grid';

  const meta = (lastData && lastData.meta) || {};
  const diasTotal     = meta.diasUteisTotal     || 22;
  const diasDecorrido = meta.diasUteisDecorridos || Math.max(1, diasTotal - (meta.diasUteisRestantes || 0));

  ranking.forEach((v, i) => {
    const pos = i + 1;
    const metaMes = v.meta_mes || ((v.meta_dia || 2) * 22);
    const pct = Math.min(100, (v.contratos.mes / Math.max(1, metaMes)) * 100);
    const nome = nomeDisp(v);
    const cls = areaClass(v.area);
    const cor = cls === 'area-serv' ? '#ff6b35' : '#00d9ff';
    const fotoUrl = fixDriveUrl(v.foto);
    const fotoFallback = fotoSVG(nome[0] || '?', cor);

    const pace = paceStatus(v.contratos.mes, metaMes, diasDecorrido, diasTotal);
    const badges = badgesVendedora(v, pos);
    const arrow = setaPosicao(pos, v.posicao_anterior);

    let chase = '';
    if (pos > 1) {
      const acima = ranking[i - 1];
      const diff = acima.contratos.mes - v.contratos.mes;
      if (diff === 0)      chase = `Empatada com <strong>${nomeDisp(acima)}</strong>`;
      else if (diff === 1) chase = `A <strong>1</strong> de alcançar <strong>${nomeDisp(acima).split(' ')[0]}</strong>`;
      else                 chase = `A <strong>${diff}</strong> de ultrapassar <strong>${nomeDisp(acima).split(' ')[0]}</strong>`;
    } else {
      const abaixo = ranking[i + 1];
      if (abaixo) {
        const gap = v.contratos.mes - abaixo.contratos.mes;
        chase = gap > 0
          ? `<strong>${gap}</strong> à frente de <strong>${nomeDisp(abaixo).split(' ')[0]}</strong>`
          : `<strong>${nomeDisp(abaixo).split(' ')[0]}</strong> empatada — defenda!`;
      }
    }

    const streakHtml = (v.streak || 0) >= 2
      ? `<div class="vcard-streak">🔥 ${v.streak}</div>` : '';

    const badgesHtml = badges.map(b =>
      `<span class="vcard-badge-ico" title="${b.tip}">${b.ico}</span>`
    ).join('');

    const card = document.createElement('div');
    card.className = 'vcard rank-' + pos + ' ' + cls;
    card.style.animationDelay = (i * 0.08) + 's';
    card.innerHTML = `
      <div class="vcard-header">
        <div class="vcard-pos-grp">
          <div class="vcard-pos">${pos}°</div>
          <div class="vcard-arrow ${arrow.cls}">${arrow.txt}</div>
        </div>
        <div class="vcard-pace ${pace.cls}">${pace.tag} ${pace.label}</div>
      </div>

      <div class="vcard-photo-wrap">
        <img class="vcard-photo" src="${fotoUrl}" data-fallback="${fotoFallback}" alt="${nome}">
        ${streakHtml}
      </div>

      <div class="vcard-name">${nome}</div>
      <div class="vcard-area">${areaBadge(v.area)}</div>

      ${badgesHtml ? `<div class="vcard-badges">${badgesHtml}</div>` : '<div class="vcard-badges-spacer"></div>'}

      <div class="vcard-stats">
        <div class="vcard-stat">
          <div class="vcard-stat-val">${v.contratos.mes}</div>
          <div class="vcard-stat-lbl">MÊS</div>
        </div>
        <div class="vcard-stat">
          <div class="vcard-stat-val">${v.contratos.semana}</div>
          <div class="vcard-stat-lbl">SEMANA</div>
        </div>
        <div class="vcard-stat">
          <div class="vcard-stat-val">${v.contratos.dia}<span class="vcard-stat-meta">/${v.meta_dia || 2}</span></div>
          <div class="vcard-stat-lbl">HOJE</div>
        </div>
      </div>

      <div class="vcard-progress">
        <div class="vcard-progress-info">
          <span>Meta: <strong>${v.contratos.mes}/${metaMes}</strong></span>
          <span class="vcard-pct"><strong>${pct.toFixed(0)}%</strong></span>
        </div>
        <div class="vcard-progress-bar">
          <div class="vcard-progress-fill" style="width:${pct}%"></div>
        </div>
      </div>

      <div class="vcard-footer">
        <div class="vcard-conv">Conversão: <strong>${v.conversao.toFixed(1)}%</strong></div>
        <div class="vcard-chase">${chase}</div>
      </div>
    `;
    container.appendChild(card);
  });

  container.querySelectorAll('img').forEach(img => {
    img.onerror = () => { img.src = img.dataset.fallback; img.onerror = null; };
  });
}

function renderConversao(ranking) {
  const container = document.getElementById('conversao-list');
  if (!container) return;
  container.innerHTML = '';

  const ordenado = [...ranking].sort((a, b) => b.conversao - a.conversao);

  const layoutConv = (lastData && lastData.config && lastData.config.rankingConversaoLayout)
                  || CFG.RANKING_CONVERSAO_LAYOUT || 'cards';

  if (layoutConv === 'horizontal') {
    container.className = 'ranking-list';
    _renderConversaoHorizontal(container, ordenado);
  } else {
    container.className = 'ranking-cards-grid';
    _renderConversaoCards(container, ordenado);
  }

  container.querySelectorAll('img').forEach(img => {
    img.onerror = () => { img.src = img.dataset.fallback; img.onerror = null; };
  });
}

function _buildConvChase(ordenado, i, pos) {
  if (pos > 1) {
    const acima = ordenado[i - 1];
    const diff = (acima.conversao - ordenado[i].conversao).toFixed(1);
    return diff === '0.0'
      ? `Empatada com <strong>${nomeDisp(acima).split(' ')[0]}</strong>`
      : `A <strong>${diff}%</strong> de alcançar <strong>${nomeDisp(acima).split(' ')[0]}</strong>`;
  }
  const abaixo = ordenado[i + 1];
  if (abaixo) {
    const gap = (ordenado[i].conversao - abaixo.conversao).toFixed(1);
    return Number(gap) > 0
      ? `<strong>${gap}%</strong> à frente de <strong>${nomeDisp(abaixo).split(' ')[0]}</strong>`
      : `<strong>${nomeDisp(abaixo).split(' ')[0]}</strong> empatada — defenda!`;
  }
  return '';
}

function _renderConversaoCards(container, ordenado) {
  ordenado.forEach((v, i) => {
    const pos = i + 1;
    const nome = nomeDisp(v);
    const cls = areaClass(v.area);
    const cor = cls === 'area-serv' ? '#ff6b35' : '#00d9ff';
    const fotoUrl = fixDriveUrl(v.foto);
    const fotoFallback = fotoSVG(nome[0] || '?', cor);
    const metaConv = Number(v.meta_conversao) || 0;
    const pctMeta = metaConv > 0 ? Math.min(100, (v.conversao / metaConv) * 100) : 0;
    const pace  = convPaceStatus(v.conversao, metaConv);
    const chase = _buildConvChase(ordenado, i, pos);

    const card = document.createElement('div');
    card.className = 'vcard rank-' + pos + ' ' + cls;
    card.style.animationDelay = (i * 0.08) + 's';
    card.innerHTML = `
      <div class="vcard-header">
        <div class="vcard-pos">${pos}°</div>
        <span class="vcard-pace ${pace.cls}">${pace.tag}</span>
      </div>

      <div class="vcard-photo-wrap">
        <img class="vcard-photo" src="${fotoUrl}" data-fallback="${fotoFallback}" alt="${nome}">
      </div>

      <div class="vcard-name">${nome}</div>
      <div class="vcard-area">${areaBadge(v.area)}</div>

      <div class="conv-big-pct">${v.conversao.toFixed(1)}%</div>

      <div class="vcard-progress">
        <div class="vcard-progress-info">
          <span>Meta: <strong>${metaConv}%</strong></span>
          <span class="vcard-pct"><strong>${pctMeta.toFixed(0)}%</strong> da meta</span>
        </div>
        <div class="vcard-progress-bar">
          <div class="vcard-progress-fill" style="width:${pctMeta}%"></div>
        </div>
      </div>

      <div class="vcard-footer">
        <div class="vcard-conv">${v.contratos.mes} contratos · ${v.leads.mes} leads</div>
        <div class="vcard-chase">${chase}</div>
      </div>
    `;
    container.appendChild(card);
  });
}

function _renderConversaoHorizontal(container, ordenado) {
  ordenado.forEach((v, i) => {
    const pos = i + 1;
    const nome = nomeDisp(v);
    const cls = areaClass(v.area);
    const cor = cls === 'area-serv' ? '#ff6b35' : '#00d9ff';
    const fotoUrl = fixDriveUrl(v.foto);
    const fotoFallback = fotoSVG(nome[0] || '?', cor);
    const metaConv = Number(v.meta_conversao) || 0;
    const pctMeta = metaConv > 0 ? Math.min(100, (v.conversao / metaConv) * 100) : 0;
    const pace  = convPaceStatus(v.conversao, metaConv);
    const chase = _buildConvChase(ordenado, i, pos);

    const item = document.createElement('div');
    item.className = 'ranking-item rank-' + pos + ' ' + cls;
    item.style.animationDelay = (i * 0.1) + 's';
    item.innerHTML = `
      <div class="rank-position"><span class="rank-pos-num">${pos}°</span></div>
      <img class="rank-foto" src="${fotoUrl}" data-fallback="${fotoFallback}" alt="${nome}">
      <div class="rank-info">
        <div class="rank-nome-line">
          <span class="rank-nome">${nome}</span>
          ${areaBadge(v.area)}
        </div>
        <div class="rank-chase">${chase}</div>
        <div class="rank-stats">
          <span>Contratos: <strong>${v.contratos.mes}</strong></span>
          <span>Leads: <strong>${v.leads.mes}</strong></span>
          <span>Meta conversão: <strong>${metaConv}%</strong></span>
          <span class="rank-pace ${pace.cls}">${pace.tag}</span>
        </div>
        <div class="rank-bar"><div class="rank-bar-fill" style="width:${pctMeta}%"></div></div>
      </div>
      <div class="rank-numbers">
        <div class="rank-big">${v.conversao.toFixed(1)}%</div>
        <div class="rank-big-label">conversão<br>no mês</div>
      </div>
    `;
    container.appendChild(item);
  });
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

function getSlideDuration() {
  return (currentSlide === 0
    ? (CFG.DASHBOARD_DURATION_SECONDS || 20)
    : (CFG.RANKING_DURATION_SECONDS   || 12)
  ) * 1000;
}

function startSlideRotation() {
  stopSlideRotation();
  if (isPinned) return;
  function schedule() {
    slideTimer = setTimeout(() => {
      if (!isPinned && !isCelebrating) {
        nextSlide();
        schedule();
      }
    }, getSlideDuration());
  }
  schedule();
}

function stopSlideRotation() {
  if (slideTimer) { clearTimeout(slideTimer); slideTimer = null; }
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

// Lê os toggles de celebração vindos do servidor (config).
// Default: ambos LIGADOS. Só desliga com valor explicitamente falso.
function celebracaoVisualAtiva() {
  const c = (lastData && lastData.config) || {};
  return !(c.celebracaoVisual === false || c.celebracaoVisual === 'false' || c.celebracaoVisual === 'FALSE');
}
function celebracaoSomAtivo() {
  const c = (lastData && lastData.config) || {};
  return !(c.celebracaoSom === false || c.celebracaoSom === 'false' || c.celebracaoSom === 'FALSE');
}

async function processCelebrationQueue() {
  if (isCelebrating || celebrationQueue.length === 0) return;
  // Drena eventos com funil fora da whitelist sem celebrar.
  // Eventos de teste (atalhos T/Y/U/1-5) trazem ev.intensity e bypassam a checagem.
  while (celebrationQueue.length > 0) {
    const peek = celebrationQueue[0];
    const ehTeste = peek && peek.intensity != null;
    const funil   = String((peek && peek.funil) || '').trim();
    if (ehTeste || FUNIS_CELEBRACAO_PERMITIDOS.indexOf(funil) >= 0) break;
    console.warn('[PQRS] Evento descartado — funil fora da whitelist:', funil, peek);
    celebrationQueue.shift();
  }
  if (celebrationQueue.length === 0) return;

  // Se ambas as celebrações (visual e som) estão desligadas nas configurações,
  // apenas drena a fila sem animar/tocar — mas mantém os números atualizados.
  if (!celebracaoVisualAtiva() && !celebracaoSomAtivo()) {
    celebrationQueue = [];
    refreshData();
    setTimeout(refreshData, 3000);
    return;
  }

  isCelebrating = true;
  const ev = celebrationQueue.shift();
  await celebrate(ev);
  isCelebrating = false;
  // Refresh imediato (cache já foi invalidado pelo webhook no servidor)
  refreshData();
  // Segundo refresh após 3s para garantir que o Pipedrive já retornou o dado novo
  setTimeout(refreshData, 3000);
  setTimeout(processCelebrationQueue, 1000);
}

async function celebrate(ev) {
  const mostrarVisual = celebracaoVisualAtiva();
  const tocarSom      = celebracaoSomAtivo();

  const cel = document.getElementById('celebracao');

  // Garante dados frescos antes de decidir a intensidade.
  // O webhook invalidou o cache no servidor; este refresh traz o estado real
  // logo após o contrato (sem precisar adivinhar com +1).
  try { await refreshData(); } catch (e) {}

  // ─── Localizar a vendedora certa ───
  // Como a mesma pessoa pode ter 2 cadastros (uma por área), casamos também
  // pela área derivada do funil do evento para pegar o registro correto.
  const areaEvento = String(ev.funil || '').toLowerCase().includes('servidor') ? 'area-serv' : 'area-trab';
  let contratosHoje   = 1;
  let contratosSemana = 0;
  let contratosMes    = 0;
  let metaDia = 2;
  let metaMes = 0;
  let totalMes = '— no mês';
  let fotoUrl = '';
  let nomeExibido = ev.vendedor || 'Vendedor';

  if (lastData && lastData.ranking) {
    const candidatos = lastData.ranking.filter(x => x.nome === ev.vendedor);
    const v = candidatos.find(x => areaClass(x.area) === areaEvento) || candidatos[0];
    if (v) {
      nomeExibido = nomeDisp(v);
      // lastData já reflete o contrato recém-fechado, então NÃO somamos +1.
      contratosHoje   = Math.max(v.contratos.dia || 0, 1);
      contratosSemana = v.contratos.semana || 0;
      contratosMes    = v.contratos.mes || 0;
      metaDia = v.meta_dia || 2;
      metaMes = v.meta_mes || 0;
      totalMes = v.contratos.mes + ' no mês';
      fotoUrl = fixDriveUrl(v.foto);
    }
  }

  const fotoFallback = fotoSVG(nomeExibido[0] || '?', '#ffd700');

  // Meta semanal: config só tem meta/dia e meta/mês, então derivamos a da semana
  // como meta/dia × 5 dias úteis.
  const metaSemana = metaDia > 0 ? metaDia * 5 : 0;

  // Permite override via evento (ex: teste com atalhos T/Y/U)
  if (ev.intensity) {
    contratosHoje = ev.intensity === 3 ? 3 : (ev.intensity === 2 ? metaDia : 1);
  }

  // ─── Decidir o nível da celebração (do mais prestigioso ao mais simples) ───
  let intensity = 1;
  let titulo = 'CONTRATO FECHADO!';
  let emoji = '🎉';
  if (!ev.intensity && metaMes > 0 && contratosMes === metaMes) {
    intensity = 3; titulo = 'META DO MÊS BATIDA!'; emoji = '🏆';
  } else if (!ev.intensity && metaSemana > 0 && contratosSemana === metaSemana) {
    intensity = 3; titulo = 'META DA SEMANA BATIDA!'; emoji = '🔥';
  } else if (contratosHoje >= 3) {
    intensity = 3; titulo = 'HAT TRICK!'; emoji = '🚀';
  } else if (contratosHoje >= metaDia) {
    intensity = 2; titulo = 'META DO DIA BATIDA!'; emoji = '🎯';
  }

  // Som pode tocar mesmo com o visual desligado (controles independentes)
  if (tocarSom) playFanfare(intensity);

  if (mostrarVisual) {
    stopSlideRotation();

    // Aplicar classe de intensidade no container (CSS escalona o visual)
    cel.classList.remove('cel-lvl-1', 'cel-lvl-2', 'cel-lvl-3');
    cel.classList.add('cel-lvl-' + intensity);

    const tituloEl = cel.querySelector('h2');
    if (tituloEl) tituloEl.textContent = titulo;
    const emojiEl = cel.querySelector('.celebracao-emoji');
    if (emojiEl) emojiEl.textContent = emoji;

    setText('cel-nome', nomeExibido);
    setText('cel-negocio', ev.negocio || '');
    setText('cel-funil', ev.funil || '');
    setText('cel-total', totalMes);

    const foto = document.getElementById('cel-foto');
    foto.src = fotoUrl || fotoFallback;
    foto.onerror = () => { foto.src = fotoFallback; foto.onerror = null; };

    cel.classList.remove('hidden');
    startConfetti(intensity);

    const dur = (CFG.CELEBRATION_DURATION_SECONDS + (intensity - 1) * 1.5) * 1000;
    await new Promise(r => setTimeout(r, dur));

    stopConfetti();
    cel.classList.add('hidden');
    if (!isPinned) startSlideRotation();
  } else if (tocarSom) {
    // Só som: mantém a rotação normal, apenas espera o áudio terminar
    await new Promise(r => setTimeout(r, 4000));
  }
}

// ============ CELEBRAÇÃO — MP3 + multidão sintetizada ============
function playFanfare(intensity) {
  const lvl = Math.max(1, Math.min(3, intensity || 1));

  // ── 1. Toca o MP3 de celebração ──
  try {
    const audio = _celebracaoAudio || new Audio('celebracao.mp3');
    audio.currentTime = 0;
    // Volume escala com o nível: 1→75% · 2→88% · 3→100%
    audio.volume = lvl === 3 ? 1.0 : (lvl === 2 ? 0.88 : 0.75);
    audio.play().catch(e => console.warn('Celebração MP3:', e));
    // Prepara nova instância para próxima celebração
    _celebracaoAudio = null;
    setTimeout(_preloadCelebracao, 800);
  } catch (e) {
    console.error('Erro ao tocar MP3:', e);
  }

  // ── 2. Camada de multidão sintetizada (cresce com o nível) ──
  if (lvl < 1) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    const rate = ctx.sampleRate;
    const now  = ctx.currentTime;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4;
    comp.connect(ctx.destination);

    function crowd(start, dur, vol) {
      const t = now + start;
      const bsz = (rate * dur) | 0;
      const buf = ctx.createBuffer(1, bsz, rate);
      const d = buf.getChannelData(0);
      let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
      for (let i = 0; i < bsz; i++) {
        const w = Math.random()*2-1;
        b0=0.99886*b0+w*0.0555179; b1=0.99332*b1+w*0.0750759;
        b2=0.96900*b2+w*0.1538520; b3=0.86650*b3+w*0.3104856;
        b4=0.55000*b4+w*0.5329522; b5=-0.7616*b5-w*0.0168980;
        d[i] = (b0+b1+b2+b3+b4+b5+b6+w*0.5362)*0.11;
        b6 = w*0.115926;
      }
      const src = ctx.createBufferSource(); src.buffer = buf;
      const bpf = ctx.createBiquadFilter();
      bpf.type='bandpass'; bpf.frequency.value=1800; bpf.Q.value=0.6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.5);
      g.gain.linearRampToValueAtTime(vol * 0.8, t + dur - 0.8);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(bpf); bpf.connect(g); g.connect(comp);
      src.start(t); src.stop(t + dur);
    }

    // Nível 1: palminhas discretas (0.5s delay para não cobrir o início do MP3)
    // Nível 2: multidão maior, mais longa
    // Nível 3: multidão máxima + segunda onda
    if (lvl === 1) crowd(0.5, 2.0, 0.18);
    if (lvl === 2) crowd(0.4, 3.5, 0.28);
    if (lvl >= 3) { crowd(0.3, 5.0, 0.38); crowd(1.5, 4.0, 0.22); }

  } catch (e) {
    console.error('Erro na camada de multidão:', e);
  }
}

// ============ CONFETE ============
let confettiAnimId = null;
let confettiPieces = [];

function startConfetti(intensity) {
  const lvl = Math.max(1, Math.min(3, intensity || 1));
  const canvas = document.getElementById('confetti-canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const colors = ['#ffd700', '#00d9ff', '#7c4dff', '#00e676', '#ff5252', '#ff9800', '#ff6b35'];
  // Mais partículas e variação visual conforme intensidade
  const totalPieces = lvl === 3 ? 600 : (lvl === 2 ? 400 : 250);
  const maxSize     = lvl === 3 ? 18  : (lvl === 2 ? 14  : 10);
  const maxSpeed    = lvl === 3 ? 9   : (lvl === 2 ? 7   : 5);
  confettiPieces = [];
  for (let i = 0; i < totalPieces; i++) {
    confettiPieces.push({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * maxSpeed,
      vy: 2 + Math.random() * maxSpeed,
      size: 5 + Math.random() * maxSize,
      color: colors[Math.floor(Math.random() * colors.length)],
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 0.3,
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
    const dispararTeste = (lvl, idx = 0) => {
      const ranking = lastData && lastData.ranking;
      const v = ranking && ranking[idx];
      celebrationQueue.push({
        vendedor: v ? v.nome : 'Bella Rosa',
        negocio: 'TESTE - Contrato Simulado',
        funil: v ? (v.area || '1. Trabalhista') : '1. Trabalhista',
        valor: 5000,
        intensity: lvl,
      });
      processCelebrationQueue();
    };
    if (e.key === 't' || e.key === 'T') dispararTeste(1, 0); // 1ª do ranking
    if (e.key === 'y' || e.key === 'Y') dispararTeste(2, 0); // meta do dia batida
    if (e.key === 'u' || e.key === 'U') dispararTeste(3, 0); // hat trick
    // Teclas 1-5: teste com vendedora específica pelo índice no ranking
    if (e.key >= '1' && e.key <= '5') dispararTeste(1, Number(e.key) - 1);
    if (e.key === 'n' || e.key === 'N') { nextSlide(); resetTimerIfNotPinned(); }
    if (e.key === 'p' || e.key === 'P') { prevSlide(); resetTimerIfNotPinned(); }
    if (e.key === 'f' || e.key === 'F') togglePin();
    if (e.key === ' ') { e.preventDefault(); togglePin(); }
  });
}

init();
