/**
 * Configuração do Dashboard PQRS
 * Edite a URL abaixo com a do seu Apps Script publicado como Web App.
 */
window.PQRS_CONFIG = {
  // URL do Apps Script Web App (substituir após implantar)
  // Formato: https://script.google.com/macros/s/SEU_ID_AQUI/exec
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxdQ-mHhUKiVEE4iLL50Rw-pWAz07V0bbj4AAhgf8x32eowNEZUESYK9MXvAPN6YAne/exec',

  // Intervalo de atualização dos dados gerais (segundos)
  REFRESH_DATA_SECONDS: 90,

  // Intervalo de checagem de novos contratos fechados (segundos)
  CHECK_EVENTS_SECONDS: 5,

  // Duração do dashboard (slide 1) — o foco (segundos)
  DASHBOARD_DURATION_SECONDS: 20,

  // Duração dos slides de ranking (slides 2 e 3) (segundos)
  RANKING_DURATION_SECONDS: 12,

  // Duração da celebração (segundos)
  CELEBRATION_DURATION_SECONDS: 12,

  // Layout do slide de ranking: 'cards' (novo, em cards individuais) ou 'horizontal' (antigo, lista)
  RANKING_LAYOUT: 'cards',

  // Layout do slide de ranking por conversão: 'cards' ou 'horizontal'
  RANKING_CONVERSAO_LAYOUT: 'cards',

  // Meta de conversão padrão (%) para o slide de conversão
  META_CONVERSAO: 5,
};
