/**
 * Configuração do Dashboard PQRS
 * Edite a URL abaixo com a do seu Apps Script publicado como Web App.
 */
window.PQRS_CONFIG = {
  // URL do Apps Script Web App (substituir após implantar)
  // Formato: https://script.google.com/macros/s/SEU_ID_AQUI/exec
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxdQ-mHhUKiVEE4iLL50Rw-pWAz07V0bbj4AAhgf8x32eowNEZUESYK9MXvAPN6YAne/exec',

  // Intervalo de atualização dos dados gerais (segundos)
  REFRESH_DATA_SECONDS: 60,

  // Intervalo de checagem de novos contratos fechados (segundos)
  CHECK_EVENTS_SECONDS: 15,

  // Duração de cada slide (segundos)
  SLIDE_DURATION_SECONDS: 15,

  // Duração da celebração (segundos)
  CELEBRATION_DURATION_SECONDS: 12,
};
