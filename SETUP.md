# PQRS Dashboard — Guia de Instalação (v2 com API do Pipedrive)

Sistema completo de dashboard comercial para TV, com:
- **Zero delay** — dados em tempo real direto da API do Pipedrive
- Slides rotativos (Visão Geral, Ranking, Conversão)
- Celebração instantânea de contratos fechados (~5 segundos do "Ganho" até a TV)
- Som de sino + confete + foto da vendedora
- Painel de configurações com CRUD de vendedoras e meta mensal
- Hospedagem na internet (Vercel) — acessível de qualquer lugar

---

## Ordem CORRETA de instalação

> ⚠ **Não pule etapas e não abra os arquivos HTML antes de terminar os passos do backend.** Você verá erros. É normal.

```
[1] Pegar token da API do Pipedrive
   ↓
[2] Descobrir IDs dos funis
   ↓
[3] Editar Code.gs com token + IDs
   ↓
[4] Implantar Apps Script como Web App
   ↓
[5] Configurar webhook no Pipedrive
   ↓
[6] Hospedar dashboard no Vercel (ou local)
   ↓
[7] Cadastrar vendedoras no painel de config
   ↓
[8] Abrir na TV em modo kiosk
```

---

## PASSO 1 — Token da API do Pipedrive

1. No Pipedrive, clique no seu nome (canto superior direito) → **Configurações**
2. **Preferências pessoais** → aba **API**
3. Copie o **Token pessoal da API**

> ⚠ Esse token dá acesso total à sua conta. Não compartilhe. Vai ficar dentro do Apps Script (que é privado).

---

## PASSO 2 — Descobrir IDs dos funis

1. Na planilha, abra **Extensões → Apps Script**
2. Cole o conteúdo de `apps-script/Code.gs`
3. Edite a linha:
   ```js
   const PIPEDRIVE_TOKEN = 'COLE_AQUI_SEU_TOKEN_DO_PIPEDRIVE';
   ```
   Coloque o token do passo 1.
4. Confirme que `PIPEDRIVE_DOMAIN` está correto (no caso, `'patezqueirozronconiestrauch'`)
5. Salve (Ctrl+S)
6. No menu superior, selecione a função **`descobrirFunis`** e clique em **Executar**
7. Na primeira vez, autorize o acesso à sua conta
8. Abra os logs (Ctrl+Enter ou Visualizar → Logs). Você verá algo como:
   ```
   1: 1. Trabalhista
   2: 2. Servidor Público
   3: Outros (inativo)
   ```
9. Anote os IDs reais de "1. Trabalhista" e "2. Servidor Público"

---

## PASSO 3 — Editar Code.gs com os IDs

Volte no Code.gs e ajuste as linhas:

```js
const PIPELINE_TRABALHISTA_ID = 1;        // ← coloque o ID real
const PIPELINE_SERVIDOR_ID = 2;           // ← coloque o ID real
```

Salve.

### Conferir nomes dos usuários
Execute a função **`descobrirUsuarios`**. Vai listar todos os usuários do Pipedrive. **Anote os nomes exatos das vendedoras** (Bella Rosa, Raquel Rodrigues, Micaela Felipe, Cristina). Esses nomes precisam bater com a aba "Vendedores" da planilha.

### Testar
Execute **`testarDashboard`** — deve aparecer nos logs algo como:
```
Total deals analisados: 614
Contratos mês: 20
Leads mês: 614
Conversão: 3.26%
```

Se aparecer, a integração com Pipedrive está funcionando!

---

## PASSO 4 — Publicar como Web App

1. No editor do Apps Script, clique em **Implantar → Nova implantação**
2. Selecione tipo: **App da Web** (clique no ícone de engrenagem ao lado de "Selecione tipo")
3. Configure:
   - **Descrição**: "PQRS Dashboard v2"
   - **Executar como**: Eu mesmo
   - **Quem pode acessar**: **Qualquer pessoa** ← obrigatório para o webhook
4. Clique em **Implantar**
5. Copie a **URL gerada** (formato: `https://script.google.com/macros/s/AKfycby.../exec`)

> 💡 **Cada vez que alterar o código do Apps Script**, vá em "Gerenciar implantações" → editar → "Versão" → "Nova versão" → Implantar. Senão a URL antiga continua com a versão antiga.

### Testar a URL
Abra no navegador: `https://script.google.com/macros/s/SEU_ID/exec?action=ping`
Deve retornar: `{"ok":true,"time":"...","domain":"patezqueirozronconiestrauch"}`

---

## PASSO 5 — Configurar webhook no Pipedrive

1. No Pipedrive, **Configurações → Ferramentas e aplicativos → Webhooks**
2. Clique em **+ Webhook**
3. Configure:
   - **URL do endpoint**: cole a URL do Apps Script
   - **Versão HTTP**: v2 (recomendado)
   - **Tipo de evento**: `change.deal` (negócio atualizado)
   - **Autenticação**: nenhuma
4. Salve

### Testar
Pegue um negócio em aberto do funil "1. Trabalhista", marque como **Ganho**. Em poucos segundos, deve aparecer uma linha na aba **Eventos** da sua planilha.

---

## PASSO 6 — Hospedar o Dashboard

### Opção recomendada: Vercel (gratuito, 2 minutos)

1. Crie conta em **[vercel.com](https://vercel.com)** (use sua conta Google)
2. Clique em **Add New → Project**
3. Escolha **Import Third-Party Git Repository** ou simplesmente arraste a pasta `pqrs-dashboard` (sem a subpasta `apps-script` — ela não precisa ir junto)
4. Antes de fazer deploy, edite o arquivo `config.js`:
   ```js
   window.PQRS_CONFIG = {
     APPS_SCRIPT_URL: 'https://script.google.com/macros/s/SEU_ID_AQUI/exec',
     ...
   };
   ```
5. Vercel gera uma URL tipo `pqrs-dashboard.vercel.app` em ~30 segundos
6. **Acesse de qualquer lugar** — abra no celular, no PC de casa, na TV do escritório

### Atualizar depois
- Conecte ao GitHub: cada commit faz deploy automático
- Ou continue subindo manualmente

### Alternativas
- **Netlify**: igualzinho ao Vercel
- **Cloudflare Pages**: também gratuito e rápido
- **GitHub Pages**: gratuito, requer conta GitHub

### Por que NÃO recomendo local
Você pediu minha opinião — eu sugiro internet por essas razões:
1. **HTTPS automático**: o som do sino e algumas APIs do navegador funcionam melhor com HTTPS
2. **Acesso remoto**: olhar os números do celular fora do escritório
3. **Não depende de PC ligado**: a TV pode ter um Fire Stick / Chromecast direto
4. **Atualizações fáceis**: edita o arquivo e faz redeploy
5. **Múltiplas TVs**: se um dia quiser pôr em outra sala, só abrir a URL

---

## PASSO 7 — Cadastrar Vendedoras

Acesse `https://sua-url.vercel.app/config.html` e:

1. Defina a **meta do mês** (ex: 90)
2. Adicione/edite vendedoras:
   - **Nome**: deve bater EXATAMENTE com o nome no Pipedrive (case-sensitive, com acentos)
   - **Foto**: URL pública. Opções:
     - Google Drive → compartilhar → pegar link direto: `https://drive.google.com/uc?id=FILE_ID`
     - Imgur (gratuito, fácil)
     - Qualquer site com URL pública da imagem
   - **Área**: "Trabalhista" ou "Servidor Público"
   - **Meta/dia**: número de contratos esperados por dia

Salve.

---

## PASSO 8 — Exibir na TV

### Opção A: Chromecast/Fire TV
1. Cast da aba do Chrome para a TV
2. F11 para tela cheia

### Opção B: PC conectado à TV
1. Abra o Chrome com:
   ```
   chrome.exe --kiosk https://sua-url.vercel.app
   ```
2. Configure inicialização automática no boot do Windows

### Opção C: Mini PC ou Raspberry Pi
1. Mais profissional, ~R$ 200 de hardware
2. Inicia direto no modo kiosk

---

## Atalhos no Dashboard

- **T** — disparar celebração de teste
- **N** — pular para próximo slide
- **F11** — tela cheia
- **F5** — recarregar

---

## Solução de Problemas

### "URL do Apps Script não configurada"
Você esqueceu de colar a URL no `config.js`. Volte ao passo 4.

### "Erro ao buscar dados: PIPEDRIVE_TOKEN não configurado"
Você esqueceu de pôr o token no Code.gs. Volte ao passo 3.

### Dashboard carrega mas mostra todos zerados
- Confira se os nomes das vendedoras na aba "Vendedores" batem com os nomes no Pipedrive
- Execute `descobrirUsuarios` no Apps Script para ver os nomes exatos no Pipedrive
- Confira se `PIPELINE_TRABALHISTA_ID` e `PIPELINE_SERVIDOR_ID` estão corretos

### Webhook não dispara celebração
- Veja se aparece linha nova na aba **Eventos**
- Se não aparecer: vá no Pipedrive → Webhook → Histórico para ver o erro
- Se aparecer mas dashboard não toca o sino: o som só funciona depois de uma interação do usuário com a página (clique na janela uma vez)

### Som de sino não toca
Navegadores bloqueiam áudio antes da primeira interação. Solução: clique uma vez na página depois de abrir, depois funciona normalmente. No modo kiosk normalmente já funciona.

### "Failed to construct 'URL': Invalid URL"
O conteúdo de `config.js` está com a string padrão `COLE_AQUI_A_URL_DO_SEU_APPS_SCRIPT`. Substitua pela URL real.

### Pipedrive cota / rate limit
O dashboard consulta a cada 60s. Em planos pagos do Pipedrive não há problema. Se cair em erro 429, aumente `REFRESH_DATA_SECONDS` em `config.js` para 120.

---

## Arquitetura Final

```
                              ┌────────────────────────────┐
                              │     PIPEDRIVE (CRM)        │
                              └─────┬──────────┬───────────┘
                          API REST  │          │  Webhook (won)
                                    │          │
                                    ▼          ▼
                              ┌──────────────────────────┐
                              │   GOOGLE APPS SCRIPT     │
                              │       (Web App)          │
                              │                          │
                              │ - Calcula KPIs em tempo  │
                              │   real via API           │
                              │ - Recebe webhook e salva │
                              │   em "Eventos"           │
                              │ - Gerencia config        │
                              └────────┬─────────────────┘
                                       │ JSON
                                       │
                              ┌────────▼─────────────────┐
                              │   DASHBOARD (Vercel)     │
                              │   pqrs.vercel.app        │
                              │                          │
                              │ - 3 slides rotativos     │
                              │ - Polling 60s (dados)    │
                              │ - Polling 15s (eventos)  │
                              │ - Confete + sino         │
                              └────────┬─────────────────┘
                                       │ HTTPS
                                       │
                              ┌────────▼─────────────────┐
                              │     TV / Celular / PC    │
                              └──────────────────────────┘
```

Delays esperados:
- Dados KPI: até 60s (limite do polling)
- Celebração de contrato fechado: ~5-10 segundos
