/**
 * PQRS Dashboard - Backend (Google Apps Script) v2 com Pipedrive API
 * =================================================================
 * Faz 3 coisas:
 *  1. Recebe webhooks do Pipedrive (negócio ganho) → celebração instantânea
 *  2. Consulta API do Pipedrive em tempo real → dados sem delay
 *  3. Gerencia configurações (meta mensal + vendedores)
 *
 * Como publicar:
 *  - Implantar > Nova implantação > Tipo: App da Web
 *  - Executar como: Eu mesmo
 *  - Quem pode acessar: Qualquer pessoa
 *  - Copiar a URL gerada e colar em config.js
 */

// =================== CONFIGURAÇÃO ===================
// ID da planilha (apenas para configurações e log de eventos — não mais para dados!)
const PLANILHA_ID = '1FmeU8HRnR9rG5YfYRpkHVgc3kc2OkX7TgziQzgrv7Ts';

// >>> PIPEDRIVE — o token agora fica guardado permanentemente em PropertiesService
// Para configurar pela primeira vez: rode a função configurarToken() abaixo
function getPipedriveToken() {
  const props = PropertiesService.getScriptProperties();
  return props.getProperty('PIPEDRIVE_TOKEN') || '';
}

/** Execute UMA VEZ para guardar o token de forma permanente.
 *  Depois disso, mesmo trocando o código todo, o token não é perdido. */
function configurarToken() {
  const TOKEN = 'be76368a2afff6b1e203ddd4f35ab62fa1320c99';
  PropertiesService.getScriptProperties().setProperty('PIPEDRIVE_TOKEN', TOKEN);
  Logger.log('✅ Token do Pipedrive guardado permanentemente!');
  Logger.log('Você pode trocar/colar novo código a vontade — o token nunca mais será perdido.');
}

// Domínio da empresa (parte antes de .pipedrive.com na URL).
// Ex: se sua URL é "patezqueirozronconiestrauch.pipedrive.com", o domínio é "patezqueirozronconiestrauch"
const PIPEDRIVE_DOMAIN = 'patezqueirozronconiestrauch';

// IDs dos funis — confirmados via descobrirFunis()
// Todos os funis monitorados (inclua aqui qualquer funil cujo "Ganho" deve contar como contrato)
const PIPELINES_TRABALHISTA = [1, 3, 9];  // 1=1.Trabalhista | 3=1.Jurídico Trabalhista | 9=1.Acordos
const PIPELINES_SERVIDOR    = [2, 10];    // 2=2.Servidor Público | 10=2.Jurídico Público

// Atalhos para compatibilidade com webhook
const PIPELINE_TRABALHISTA_ID = 1;
const PIPELINE_SERVIDOR_ID = 2;

const FUNIL_TRABALHISTA = '1. Trabalhista';
const FUNIL_SERVIDOR = '2. Servidor Público';

// Abas
const ABA_VENDEDORES = 'Vendedores';
const ABA_CONFIG = 'Config';
const ABA_EVENTOS = 'Eventos';

// =================== ROTEADOR HTTP ===================

function doGet(e) {
  const action = (e.parameter && e.parameter.action) || 'data';
  try {
    let result;
    switch (action) {
      case 'data':       result = getDashboardDataCached(); break;
      case 'events':     result = getRecentEvents(e.parameter.since); break;
      case 'config':     result = getConfig(); break;
      case 'vendedores': result = getVendedores(); break;
      case 'pipelines':  result = listPipelines(); break;  // util p/ descobrir IDs
      case 'users':      result = listPipedriveUsers(); break;  // util p/ ver nomes
      case 'ping':       result = { ok: true, time: new Date(), domain: PIPEDRIVE_DOMAIN }; break;
      default: result = { error: 'Ação desconhecida: ' + action };
    }
    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ error: String(err), stack: err.stack });
  }
}

function doPost(e) {
  try {
    const action = (e.parameter && e.parameter.action) || '';
    const payload = e.postData ? JSON.parse(e.postData.contents) : {};

    if (action === 'saveConfig')     return jsonResponse(saveConfig(payload));
    if (action === 'saveVendedores') return jsonResponse(saveVendedores(payload));

    // Sem action específica = webhook do Pipedrive
    return jsonResponse(handlePipedriveWebhook(payload));
  } catch (err) {
    return jsonResponse({ error: String(err), stack: err.stack });
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// =================== PIPEDRIVE API ===================

function pipedriveFetch(endpoint, params) {
  const token = getPipedriveToken();
  if (!token) {
    throw new Error('PIPEDRIVE_TOKEN não configurado. Execute a função configurarToken() uma vez no editor.');
  }
  const base = 'https://' + PIPEDRIVE_DOMAIN + '.pipedrive.com/api/v1';
  let url = base + endpoint + (endpoint.includes('?') ? '&' : '?') + 'api_token=' + token;
  if (params) {
    Object.keys(params).forEach(k => {
      url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    });
  }
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code >= 400) throw new Error('Pipedrive API ' + code + ': ' + text.substring(0, 200));
  return JSON.parse(text);
}

/**
 * Estratégia: 2 buscas separadas + merge.
 * 1) Negócios criados no mês corrente (para contar LEADS)
 * 2) Negócios ganhos recentemente (para pegar contratos criados antes do mês)
 * Resultado: rápido (poucas chamadas) e correto (não perde contratos antigos ganhos hoje)
 */
function fetchDealsSince(startDate) {
  const dateInicio = Utilities.formatDate(startDate, 'GMT-3', 'yyyy-MM-dd');

  // --- Query 1: deals criados no período ---
  const dealsCriados = _paginarDeals({ start_date: dateInicio, sort: 'add_time DESC' }, 5);

  // --- Query 2: últimos 300 deals ganhos (status=won) ---
  // Pipedrive API: status=won não filtra por won_time, mas sort por update_time DESC
  // pega os mais recentes (que provavelmente foram ganhos recentemente)
  const dealsGanhos = _paginarDeals({ status: 'won', sort: 'update_time DESC' }, 1);

  // Merge sem duplicar (por id)
  const map = new Map();
  dealsCriados.forEach(d => map.set(d.id, d));
  dealsGanhos.forEach(d => map.set(d.id, d));
  return Array.from(map.values());
}

function _paginarDeals(extraParams, maxPaginas) {
  const limit = 500;
  let allDeals = [];
  let start = 0;
  for (let i = 0; i < maxPaginas; i++) {
    const params = Object.assign({ start, limit }, extraParams);
    const result = pipedriveFetch('/deals', params);
    if (!result.data || result.data.length === 0) break;
    allDeals = allDeals.concat(result.data);
    const more = result.additional_data && result.additional_data.pagination &&
                 result.additional_data.pagination.more_items_in_collection;
    if (!more) break;
    start += limit;
  }
  return allDeals;
}

/** Lista pipelines (útil para descobrir IDs) */
function listPipelines() {
  const r = pipedriveFetch('/pipelines');
  return r.data.map(p => ({ id: p.id, name: p.name, active: p.active }));
}

/** Lista usuários (útil para mapear nomes) */
function listPipedriveUsers() {
  const r = pipedriveFetch('/users');
  return r.data.map(u => ({ id: u.id, name: u.name, email: u.email, active: u.active_flag }));
}

// =================== DADOS DO DASHBOARD ===================

/** Wrapper com cache de 30 segundos (acelera muito o dashboard) */
function getDashboardDataCached() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('dashboard_data');
  if (cached) {
    try {
      const data = JSON.parse(cached);
      data._cached = true;
      return data;
    } catch (e) {}
  }
  const data = getDashboardData();
  try {
    cache.put('dashboard_data', JSON.stringify(data), 30); // 30 segundos
  } catch (e) {
    // se passar do limite de 100KB do cache, ignora
  }
  return data;
}

function getDashboardData() {
  const agora = new Date();
  const inicioDia = startOfDay(agora);
  const inicioSemana = startOfWeek(agora);
  const inicioMes = startOfMonth(agora);

  // Buscar negócios numa janela ampla (90 dias atrás)
  const deals = fetchDealsSince(inicioMes);

  // Filtrar apenas dos funis relevantes (trabalhista + servidor)
  const todosPipelinesAtivos = [...PIPELINES_TRABALHISTA, ...PIPELINES_SERVIDOR];
  const dealsFiltrados = deals.filter(d => todosPipelinesAtivos.includes(d.pipeline_id));

  // Carregar SOMENTE vendedoras ATIVAS
  const vendedoras = getVendedores().filter(v => v.ativo);
  const stats = {};
  vendedoras.forEach(v => {
    stats[v.nome] = {
      contratos: { dia: 0, semana: 0, mes: 0 },
      leads:     { dia: 0, semana: 0, mes: 0 },
    };
  });

  // Totais gerais
  const totalLeads     = { dia: 0, semana: 0, mes: 0 };
  const totalContratos = { dia: 0, semana: 0, mes: 0 };

  // Totais POR ÁREA
  const trabalhista = {
    contratos: { dia: 0, semana: 0, mes: 0 },
    leads:     { dia: 0, semana: 0, mes: 0 },
  };
  const servidor = {
    contratos: { dia: 0, semana: 0, mes: 0 },
    leads:     { dia: 0, semana: 0, mes: 0 },
  };

  dealsFiltrados.forEach(deal => {
    const ownerName = (deal.user_id && deal.user_id.name) || deal.owner_name || '';
    if (!stats[ownerName]) return; // ignora deals de pessoas que não estão na lista de vendedoras ativas

    const addTime = parseDate(deal.add_time);
    const wonTime = parseDate(deal.won_time);

    // Identificar área deste deal pelo pipeline
    const areaDoDeal = PIPELINES_TRABALHISTA.includes(deal.pipeline_id) ? 'trabalhista' : 'servidor';
    const bucketArea = areaDoDeal === 'trabalhista' ? trabalhista : servidor;

    // LEAD — conta pela data de criação
    if (addTime) {
      if (addTime >= inicioMes)    { stats[ownerName].leads.mes++;    totalLeads.mes++;    bucketArea.leads.mes++; }
      if (addTime >= inicioSemana) { stats[ownerName].leads.semana++; totalLeads.semana++; bucketArea.leads.semana++; }
      if (addTime >= inicioDia)    { stats[ownerName].leads.dia++;    totalLeads.dia++;    bucketArea.leads.dia++; }
    }

    // CONTRATO — conta pela data de fechamento (won_time), mesmo se criado antes
    if (deal.status === 'won' && wonTime) {
      if (wonTime >= inicioMes)    { stats[ownerName].contratos.mes++;    totalContratos.mes++;    bucketArea.contratos.mes++; }
      if (wonTime >= inicioSemana) { stats[ownerName].contratos.semana++; totalContratos.semana++; bucketArea.contratos.semana++; }
      if (wonTime >= inicioDia)    { stats[ownerName].contratos.dia++;    totalContratos.dia++;    bucketArea.contratos.dia++; }
    }
  });

  // Ranking
  const ranking = vendedoras.map(v => {
    const s = stats[v.nome];
    const conv = s.leads.mes > 0 ? (s.contratos.mes / s.leads.mes) * 100 : 0;
    return {
      nome: v.nome,
      foto: v.foto,
      area: v.area,
      meta_dia: v.meta_dia || 2,
      contratos: s.contratos,
      leads: s.leads,
      conversao: conv,
    };
  });

  ranking.sort((a, b) => {
    if (b.contratos.mes !== a.contratos.mes) return b.contratos.mes - a.contratos.mes;
    return b.conversao - a.conversao;
  });

  const config = getConfig();

  // --- Metas separadas por área (com fallback p/ metaMensal antigo) ---
  const metaTrab = Number(config.metaTrabalhista || config.metaMensal || 40) || 40;
  const metaServ = Number(config.metaServidor || 20) || 20;
  const totalMeta = metaTrab + metaServ;

  const convMes = totalLeads.mes > 0 ? (totalContratos.mes / totalLeads.mes) * 100 : 0;
  const convSemana = totalLeads.semana > 0 ? (totalContratos.semana / totalLeads.semana) * 100 : 0;
  const convDia = totalLeads.dia > 0 ? (totalContratos.dia / totalLeads.dia) * 100 : 0;

  const diasUteisRestantes = diasUteisAteFimMes(agora);

  // Progresso por área
  const faltamTrab = Math.max(0, metaTrab - trabalhista.contratos.mes);
  const faltamServ = Math.max(0, metaServ - servidor.contratos.mes);
  const pctTrab = metaTrab > 0 ? (trabalhista.contratos.mes / metaTrab) * 100 : 0;
  const pctServ = metaServ > 0 ? (servidor.contratos.mes / metaServ) * 100 : 0;

  const contratosRestantesTotal = faltamTrab + faltamServ;
  const ritmoNecessario = diasUteisRestantes > 0 ? contratosRestantesTotal / diasUteisRestantes : 0;

  // Conversão por área
  const convTrabalhista = trabalhista.leads.mes > 0 ? (trabalhista.contratos.mes / trabalhista.leads.mes) * 100 : 0;
  const convServidor    = servidor.leads.mes > 0    ? (servidor.contratos.mes / servidor.leads.mes) * 100 : 0;

  return {
    timestamp: agora.toISOString(),
    fonte: 'pipedrive_api',
    totalDealsAnalisados: dealsFiltrados.length,
    meta: {
      // Por área (novo)
      trabalhista: {
        mensal: metaTrab,
        fechadosMes: trabalhista.contratos.mes,
        restantes: faltamTrab,
        percentual: pctTrab,
      },
      servidor: {
        mensal: metaServ,
        fechadosMes: servidor.contratos.mes,
        restantes: faltamServ,
        percentual: pctServ,
      },
      // Totais (compatibilidade)
      mensal: totalMeta,
      fechadosMes: totalContratos.mes,
      restantes: contratosRestantesTotal,
      percentual: totalMeta > 0 ? (totalContratos.mes / totalMeta) * 100 : 0,
      diasUteisRestantes,
      ritmoNecessarioDia: ritmoNecessario,
    },
    totais: {
      contratos: totalContratos,
      leads: totalLeads,
      conversao: { mes: convMes, semana: convSemana, dia: convDia },
    },
    porArea: {
      trabalhista: {
        contratos: trabalhista.contratos,
        leads: trabalhista.leads,
        conversao: convTrabalhista,
      },
      servidor: {
        contratos: servidor.contratos,
        leads: servidor.leads,
        conversao: convServidor,
      },
    },
    ranking,
    config,
  };
}

// =================== WEBHOOK ===================

function handlePipedriveWebhook(payload) {
  const current = payload.current || (payload.data && payload.data.current) || payload.data || {};
  const previous = payload.previous || (payload.data && payload.data.previous) || {};

  const newStatus = (current.status || '').toLowerCase();
  const oldStatus = (previous.status || '').toLowerCase();

  if (newStatus !== 'won') return { skipped: true, reason: 'status não é won', got: newStatus };
  if (oldStatus === 'won') return { skipped: true, reason: 'já estava won' };

  const pipelineId = current.pipeline_id;
  const todosPipelines = [...PIPELINES_TRABALHISTA, ...PIPELINES_SERVIDOR];
  if (!todosPipelines.includes(pipelineId)) {
    return { skipped: true, reason: 'funil não monitorado, id: ' + pipelineId };
  }

  const pipelineName = PIPELINES_TRABALHISTA.includes(pipelineId) ? FUNIL_TRABALHISTA : FUNIL_SERVIDOR;
  const userName = (current.user_id && current.user_id.name) || current.owner_name || 'Vendedor';
  const dealTitle = current.title || 'Negócio';
  const dealValue = current.value || 0;

  const ss = SpreadsheetApp.openById(PLANILHA_ID);
  let aba = ss.getSheetByName(ABA_EVENTOS);
  if (!aba) {
    aba = ss.insertSheet(ABA_EVENTOS);
    aba.appendRow(['Timestamp', 'Vendedor', 'Negócio', 'Valor', 'Funil', 'Deal ID']);
    aba.getRange('A1:F1').setFontWeight('bold');
  }

  aba.appendRow([new Date(), userName, dealTitle, dealValue, pipelineName, current.id]);
  return { success: true, vendedor: userName, pipeline: pipelineName, deal: dealTitle };
}

function getRecentEvents(sinceParam) {
  const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 5 * 60 * 1000);
  const ss = SpreadsheetApp.openById(PLANILHA_ID);
  const aba = ss.getSheetByName(ABA_EVENTOS);
  if (!aba) return { events: [], serverTime: new Date().toISOString() };

  const dados = aba.getDataRange().getValues();
  if (dados.length < 2) return { events: [], serverTime: new Date().toISOString() };

  dados.shift();
  const eventos = dados
    .map(l => ({ timestamp: l[0], vendedor: l[1], negocio: l[2], valor: l[3], funil: l[4], dealId: l[5] }))
    .filter(ev => ev.timestamp && new Date(ev.timestamp) > since);

  return { events: eventos, serverTime: new Date().toISOString() };
}

// =================== CONFIG ===================

function getConfig() {
  const ss = SpreadsheetApp.openById(PLANILHA_ID);
  let aba = ss.getSheetByName(ABA_CONFIG);
  if (!aba) {
    aba = ss.insertSheet(ABA_CONFIG);
    aba.appendRow(['chave', 'valor']);
    aba.appendRow(['metaTrabalhista', 40]);
    aba.appendRow(['metaServidor', 20]);
    aba.appendRow(['intervaloSlide', 15]);
    aba.getRange('A1:B1').setFontWeight('bold');
  }
  const dados = aba.getDataRange().getValues();
  dados.shift();
  const config = {};
  dados.forEach(linha => {
    let v = linha[1];
    if (typeof v === 'string' && (v.startsWith('{') || v.startsWith('['))) {
      try { v = JSON.parse(v); } catch (e) {}
    }
    config[linha[0]] = v;
  });
  return config;
}

function saveConfig(payload) {
  const ss = SpreadsheetApp.openById(PLANILHA_ID);
  let aba = ss.getSheetByName(ABA_CONFIG);
  if (!aba) {
    aba = ss.insertSheet(ABA_CONFIG);
    aba.appendRow(['chave', 'valor']);
  }
  const dados = aba.getDataRange().getValues();
  dados.shift();
  const chaves = dados.map(l => l[0]);

  Object.keys(payload).forEach(k => {
    let v = payload[k];
    if (typeof v === 'object') v = JSON.stringify(v);
    const idx = chaves.indexOf(k);
    if (idx >= 0) {
      aba.getRange(idx + 2, 2).setValue(v);
    } else {
      aba.appendRow([k, v]);
    }
  });
  return { success: true };
}

/**
 * Execute UMA VEZ para adicionar as chaves metaTrabalhista e metaServidor
 * na aba Config (caso ela já exista com metaMensal).
 */
function inicializarConfig() {
  const ss = SpreadsheetApp.openById(PLANILHA_ID);
  let aba = ss.getSheetByName(ABA_CONFIG);
  if (!aba) {
    Logger.log('Aba Config não encontrada — será criada automaticamente na próxima chamada de getConfig().');
    return;
  }
  const dados = aba.getDataRange().getValues();
  const chaves = dados.slice(1).map(l => String(l[0]).trim().toLowerCase());

  if (!chaves.includes('metatrabalhista')) {
    aba.appendRow(['metaTrabalhista', 40]);
    Logger.log('Adicionada linha metaTrabalhista = 40');
  } else {
    Logger.log('metaTrabalhista já existe — não alterada.');
  }
  if (!chaves.includes('metaservidor')) {
    aba.appendRow(['metaServidor', 20]);
    Logger.log('Adicionada linha metaServidor = 20');
  } else {
    Logger.log('metaServidor já existe — não alterada.');
  }
  Logger.log('Pronto! Edite os valores diretamente na aba Config da planilha.');
}

// =================== VENDEDORES ===================

function getVendedores() {
  const ss = SpreadsheetApp.openById(PLANILHA_ID);
  const aba = ss.getSheetByName(ABA_VENDEDORES);
  if (!aba) throw new Error('Aba "' + ABA_VENDEDORES + '" não encontrada na planilha.');

  const dados = aba.getDataRange().getValues();
  if (dados.length < 2) return [];

  const headers = dados.shift().map(h => String(h).toLowerCase().trim());

  // Localiza colunas — compatível com estrutura atual da planilha
  const iNome  = _col(headers, ['nome', 'vendedores'], 0);
  const iFoto  = _col(headers, ['link corrigido', 'foto', 'link foto'], -1);
  const iSaida = _col(headers, ['data da saida', 'data da saída', 'data de saida', 'data de saída', 'data saida', 'data_saida', 'saida', 'saída'], -1);
  const iAtivo = _col(headers, ['ativo'], -1);
  const iArea  = _col(headers, ['area', 'área'], -1);
  const iMeta  = _col(headers, ['meta_dia', 'meta dia', 'meta/dia'], -1);

  return dados
    .filter(l => l[iNome] && String(l[iNome]).trim() !== '')
    .map(l => {
      const nome = String(l[iNome]).trim();
      const foto = iFoto >= 0 ? String(l[iFoto] || '').trim() : '';

      // --- ATIVO ---
      // Regra 1: coluna "Data da saida" — vazia = ativo, qualquer valor = inativo
      // Regra 2: coluna "Ativo" — FALSE/Não = inativo
      // Regra 3: sem nenhuma das duas → ativo por padrão
      let ativo = true;
      if (iSaida >= 0) {
        const v = l[iSaida];
        // Célula vazia → ativo. Qualquer valor (Date, string, número) → inativo
        if (v === null || v === undefined || v === '') {
          ativo = true;
        } else if (typeof v === 'string') {
          ativo = v.trim() === '';  // string só com espaços → ativo
        } else {
          ativo = false;  // Date object, número, boolean → inativo
        }
      } else if (iAtivo >= 0) {
        const v = String(l[iAtivo] || '').toLowerCase().trim();
        ativo = v !== 'false' && v !== 'não' && v !== 'nao' && v !== '0' && v !== '';
      }

      // --- ÁREA ---
      // Lê da planilha se existir, senão usa 'Trabalhista' como padrão
      const area = (iArea >= 0 && l[iArea] && String(l[iArea]).trim() !== '')
                 ? String(l[iArea]).trim()
                 : 'Trabalhista';

      // --- META DIA ---
      const meta_dia = (iMeta >= 0 && l[iMeta]) ? Number(l[iMeta]) || 2 : 2;

      return { nome, foto, area, meta_dia, ativo };
    });
}

/** Helper: encontra índice da primeira coluna cujo nome bate com a lista */
function _col(headers, nomes, fallback) {
  for (const n of nomes) {
    const i = headers.indexOf(n);
    if (i >= 0) return i;
  }
  return fallback;
}

/**
 * Execute UMA VEZ para adicionar as colunas Area e Meta_Dia na aba Vendedores.
 * Depois disso, gerencie tudo diretamente na planilha — sem editar código.
 *
 * Regras da planilha após executar:
 *   - Para ADICIONAR vendedor: nova linha com nome exato do Pipedrive + área + meta
 *   - Para REMOVER vendedor: preencha "Data da saida" com a data de saída
 *   - Área possível: "Trabalhista" ou "Servidor Público"
 */
function inicializarColunasVendedores() {
  const ss = SpreadsheetApp.openById(PLANILHA_ID);
  const aba = ss.getSheetByName(ABA_VENDEDORES);
  if (!aba) { Logger.log('Aba Vendedores não encontrada!'); return; }

  const dados = aba.getDataRange().getValues();
  const headers = dados[0].map(h => String(h).toLowerCase().trim());

  // Verificar se as colunas já existem
  const temArea = headers.includes('area') || headers.includes('área');
  const temMeta = headers.includes('meta_dia') || headers.includes('meta dia');

  const ultimaCol = dados[0].length; // número de colunas atual

  // Adicionar cabeçalho "Area" se não existir
  if (!temArea) {
    const colArea = ultimaCol + 1;
    aba.getRange(1, colArea).setValue('Area').setFontWeight('bold');

    // Preencher valores conhecidos para vendedoras existentes
    const areaMap = {
      'bella rosa':               'Trabalhista',
      'raquel rodrigues de lima': 'Trabalhista',
      'micaela felipe oliveira':  'Trabalhista',
      'cristina belo da silva':   'Servidor Público',
    };

    for (let i = 1; i < dados.length; i++) {
      const nomeLower = String(dados[i][0] || '').toLowerCase().trim();
      const area = areaMap[nomeLower] || 'Trabalhista';
      aba.getRange(i + 1, colArea).setValue(area);
    }
    Logger.log('Coluna "Area" adicionada na coluna ' + colArea);
  } else {
    Logger.log('Coluna "Area" já existe — não alterada.');
  }

  // Adicionar cabeçalho "Meta_Dia" se não existir
  if (!temMeta) {
    const colMeta = (temArea ? ultimaCol : ultimaCol + 1) + 1;
    aba.getRange(1, colMeta).setValue('Meta_Dia').setFontWeight('bold');

    // Preencher com 2 para todas as vendedoras existentes
    for (let i = 1; i < dados.length; i++) {
      aba.getRange(i + 1, colMeta).setValue(2);
    }
    Logger.log('Coluna "Meta_Dia" adicionada na coluna ' + colMeta + ' com valor padrão 2');
  } else {
    Logger.log('Coluna "Meta_Dia" já existe — não alterada.');
  }

  Logger.log('Pronto! Agora gerencie vendedores diretamente na planilha.');
  Logger.log('Colunas finais: ' + aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0].join(' | '));
}

function saveVendedores(vendedores) {
  const ss = SpreadsheetApp.openById(PLANILHA_ID);
  let aba = ss.getSheetByName(ABA_VENDEDORES);
  if (!aba) aba = ss.insertSheet(ABA_VENDEDORES);
  aba.clear();
  aba.appendRow(['Nome', 'Foto', 'Area', 'Meta_Dia', 'Ativo']);
  aba.getRange('A1:E1').setFontWeight('bold');
  vendedores.forEach(v => {
    aba.appendRow([v.nome, v.foto || '', v.area || 'Trabalhista', v.meta_dia || 2, v.ativo !== false]);
  });
  return { success: true, total: vendedores.length };
}

// =================== UTILS ===================

function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function startOfWeek(d) {
  const x = new Date(d);
  const dia = x.getDay();
  const diff = dia === 0 ? -6 : 1 - dia;
  x.setDate(x.getDate() + diff);
  x.setHours(0,0,0,0);
  return x;
}
function startOfMonth(d) { const x = new Date(d); x.setDate(1); x.setHours(0,0,0,0); return x; }

function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function diasUteisAteFimMes(d) {
  const fimMes = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  let dias = 0;
  for (let dt = new Date(d); dt <= fimMes; dt.setDate(dt.getDate() + 1)) {
    const dw = dt.getDay();
    if (dw !== 0 && dw !== 6) dias++;
  }
  return dias;
}

// =================== FUNÇÕES DE DESCOBERTA / TESTE ===================

/** Rode esta função no editor para descobrir os IDs dos seus funis */
function descobrirFunis() {
  const pipelines = listPipelines();
  Logger.log('=== FUNIS NO SEU PIPEDRIVE ===');
  pipelines.forEach(p => Logger.log(p.id + ': ' + p.name + (p.active ? '' : ' (inativo)')));
  Logger.log('Copie os IDs para PIPELINE_TRABALHISTA_ID e PIPELINE_SERVIDOR_ID no topo deste código.');
  return pipelines;
}

/** Rode para ver os usuários do Pipedrive (importante: nomes devem bater com aba Vendedores!) */
function descobrirUsuarios() {
  const users = listPipedriveUsers();
  Logger.log('=== USUÁRIOS DO PIPEDRIVE ===');
  users.forEach(u => Logger.log(u.id + ': ' + u.name + ' (' + u.email + ')' + (u.active ? '' : ' [INATIVO]')));
  Logger.log('Garanta que esses nomes batem EXATAMENTE com a coluna Nome da aba Vendedores.');
  return users;
}

function testarDashboard() {
  const data = getDashboardData();
  Logger.log('Total deals analisados: ' + data.totalDealsAnalisados);
  Logger.log('Contratos mês: ' + data.totais.contratos.mes);
  Logger.log('Leads mês: ' + data.totais.leads.mes);
  Logger.log('Conversão: ' + data.totais.conversao.mes.toFixed(2) + '%');
  Logger.log('Ranking: ' + JSON.stringify(data.ranking.map(r => ({ nome: r.nome, mes: r.contratos.mes }))));
  return data;
}

/** Rode essa função para ver EXATAMENTE como está a aba Vendedores */
function diagnosticarVendedores() {
  const ss = SpreadsheetApp.openById(PLANILHA_ID);
  const aba = ss.getSheetByName(ABA_VENDEDORES);
  if (!aba) {
    Logger.log('ERRO: Aba "' + ABA_VENDEDORES + '" não existe!');
    return;
  }
  const dados = aba.getDataRange().getValues();
  Logger.log('=== ABA VENDEDORES ===');
  Logger.log('Total de linhas: ' + dados.length);
  Logger.log('Cabeçalhos (linha 1): ' + JSON.stringify(dados[0]));
  Logger.log('Linha 2 (exemplo): ' + JSON.stringify(dados[1] || 'vazia'));
  Logger.log('Linha 3 (exemplo): ' + JSON.stringify(dados[2] || 'vazia'));
}

function testarWebhookSimulado() {
  const fake = {
    current: {
      id: 999, title: 'Contrato Teste', status: 'won', value: 5000,
      pipeline_id: PIPELINE_TRABALHISTA_ID,
      user_id: { name: 'Bella Rosa' }
    },
    previous: { status: 'open' }
  };
  Logger.log(handlePipedriveWebhook(fake));
}
