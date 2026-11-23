# Envbi — contexto do projeto (leia antes de mexer no código)

> Este arquivo é a fonte de contexto para agentes de IA (Copilot / VS Code) e para quem entrar no projeto.
> Resume tudo o que já foi decidido. O passo a passo de instalação está no `README.md`.

## 1. O que é
Uma automação de **comunicação com candidatos pelo WhatsApp** para uma recrutadora que usa o ATS **InHire** (inhire.com.br).

Dois objetivos:
1. **Bot de atendimento**: o candidato escreve no WhatsApp e uma IA responde dúvidas sobre a vaga e sobre a etapa em que ele está. Quando o assunto precisa de uma pessoa, a IA encaminha para a recrutadora.
2. **Atualizações de rotina**: a cada **3 dias** sem contato, o candidato recebe uma mensagem automática com a situação dele na vaga.

Público: recrutadora (cliente) e candidatos. Idioma de tudo: **português do Brasil**.

## 2. Status atual (fase: protótipo local)
- Roda **localmente** com Docker (n8n + túnel Cloudflare). O único custo é a API da IA.
- WhatsApp usa o **número de teste** da Meta, que envia para no máximo 5 números cadastrados.
- **InHire ainda NÃO está integrado de verdade.** Os workflows já consomem uma API HTTP, mas ela é um **InHire simulado** (`mock-inhire/server.js`, container `inhire-mock`) com dados fictícios em `data/inhire-mock/db.seed.json`. O formato dessa API foi inventado por nós; o da API real ainda é desconhecido.
- Os workflows foram gerados, mas **ainda não foram testados ponta a ponta** no n8n.
- O bot **não tem memória**: cada mensagem é respondida isoladamente.

## 3. Fluxo geral
```
InHire (vagas, candidatos, etapas)        ← hoje: InHire simulado (inhire-mock:3000)
        │  API GET /applications  +  webhook application.stage_changed
        ▼
n8n (orquestrador, JavaScript nos nós Code)
   ├─ Workflow 01: Bot ◄──── webhook ──── WhatsApp Cloud API (Meta) ◄── candidato
   │      └─ Claude (API Anthropic) gera a resposta ──► WhatsApp ──► candidato
   │                                                   └─► alerta p/ recrutadora
   ├─ Workflow 02: Agendador diário 9h ──► templates ──► WhatsApp ──► candidatos
   └─ Workflow 03: webhook do InHire (etapa mudou) ──► template ──► WhatsApp ──► candidato
```

### Workflow 01 — Bot (`workflows/01-bot-whatsapp.json`)
1. **GET `/webhook/whatsapp`**: verificação da Meta (compara `hub.verify_token` com `WA_VERIFY_TOKEN` e devolve `hub.challenge`).
2. **POST `/webhook/whatsapp`**: chega a mensagem. O nó `Extrair mensagem` ignora eventos de status (entregue, lido). Mensagens que não são texto viram uma instrução para a IA pedir que o candidato escreva.
3. `InHire: buscar candidaturas`: `GET {INHIRE_BASE_URL}/applications` com `Authorization: Bearer {INHIRE_API_TOKEN}`.
4. `Montar contexto`: converte com `deInhire()`, lê `prompt-bot.md` e `vagas.md` e acha o candidato pelos **8 últimos dígitos** do telefone. Isso é necessário porque, no Brasil, o WhatsApp às vezes manda o número sem o 9 extra.
5. `Perguntar à IA (Claude)`: faz `POST https://api.anthropic.com/v1/messages` com o modelo `ANTHROPIC_MODEL` (padrão `claude-haiku-5-5`).
6. `Preparar envios`: se a resposta começar com `[ENCAMINHAR]`, o marcador é removido e um alerta é enviado para `RECRUITER_PHONE`.
7. `Enviar WhatsApp`: faz `POST graph.facebook.com/{versão}/{PHONE_NUMBER_ID}/messages`.

### Workflow 02 — Atualizações (`workflows/02-atualizacoes-3-dias.json`)
1. Gatilho: **todo dia às 9h** (America/Sao_Paulo), mais um gatilho manual para teste.
2. `InHire: buscar candidaturas` (igual ao workflow 01).
3. `Selecionar candidatos`: converte com `deInhire()` e seleciona quem tem `consentimento_whatsapp: true`, não está em etapa final (`Contratado`, `Reprovado`, `Desistiu`) e está há `UPDATE_INTERVAL_DAYS` dias ou mais sem contato (ou nunca recebeu contato).
4. `Enviar template`: usa o template `WA_TEMPLATE_UPDATE`. `hello_world` é o template de teste; os reais usam as variáveis {{1}} nome, {{2}} vaga e {{3}} etapa. O nó usa `onError: continueRegularOutput`.
5. `Registrar contato`: grava a data em `data/contatos.json` (`{ idDaCandidatura: dataISO }`) para quem recebeu com sucesso. O último contato é dado **nosso**, não do InHire.

### Workflow 03 — Mudança de etapa (`workflows/03-mudanca-etapa.json`)
1. **POST `/webhook/inhire`**: o InHire avisa `{ event: "application.stage_changed", occurredAt, data: { application, previousStage } }`.
2. `Validar evento`: confere o header `X-Inhire-Secret` contra `INHIRE_WEBHOOK_SECRET` (erro se diferente), converte com `deInhire()` e filtra: sem consentimento → nada; `Proposta`, `Contratado`, `Desistiu` → nada (a recrutadora trata pessoalmente); `Reprovado` → `WA_TEMPLATE_CLOSE` ({{1}} nome, {{2}} vaga); demais → `WA_TEMPLATE_STAGE` ({{1}} nome, {{2}} vaga, {{3}} etapa).
3. `Enviar template` e `Registrar contato`: iguais ao workflow 02.

### InHire simulado (`mock-inhire/server.js`)
Node puro, sem dependências. Rotas em `/api/v1` (exigem Bearer token): `GET /jobs`, `GET /applications` (resposta `{ data, total }`, com a vaga embutida em `job`), `GET /applications/:id`, `PATCH /applications/:id` com `{ stage }` (valida contra as etapas da vaga e dispara o webhook), `POST /_reset`. Em `/` há um painel para mudar etapas pelo navegador (http://localhost:3000). O estado fica em `data/inhire-mock/db.json` (gerado a partir do seed, ignorado pelo git).

## 4. Ferramentas e decisões
| Item | Escolha | Por quê |
|---|---|---|
| Orquestrador | **n8n** Community (self-hosted, grátis) | Integração visual; a recrutadora consegue entender o fluxo |
| Linguagem | **JavaScript** nos nós Code do n8n | É o padrão nativo do n8n. **Se o projeto crescer → migrar para TypeScript/Node** |
| WhatsApp | **WhatsApp Cloud API oficial (Meta)** | APIs não oficiais podem fazer o número ser banido e são um risco de LGPD. **Não usar.** |
| IA | **Claude (API Anthropic)** | Respostas do bot |
| Ambiente local | **Docker Compose** | n8n + `cloudflared` + `inhire-mock` |
| InHire (enquanto não há acesso) | **Mock próprio** com API + webhook | Permite construir e testar a integração inteira; na troca, muda só URL/token e a função `deInhire()` |
| URL pública | **Cloudflare Tunnel** (quick tunnel, grátis) | A Meta exige HTTPS público; `localhost` não serve. A URL muda a cada reinício do container `tunnel` |
| Produção (futuro) | VPS (ex.: Hostinger KVM 2, ~R$ 40–70/mês) com n8n, ou n8n Cloud (~€24/mês) | Decidir depois de validar o protótipo |
| Repositório | GitHub **privado**, nome **Envbi** | |

## 5. Regras do WhatsApp que afetam o código
- **Mensagem iniciada pela empresa = template pré-aprovado pela Meta.** Use a categoria **Utilidade** (a mais barata; não pode ter conteúdo promocional). Os textos dos templates estão em `docs/templates-whatsapp.md`.
- **Janela de 24h**: texto livre só pode ser enviado se o contato escreveu nas últimas 24h. Isso vale também para o alerta à recrutadora.
- O número de teste só envia para até 5 destinatários cadastrados no painel. No Brasil, às vezes é preciso cadastrar o número com e sem o 9.
- O token temporário da Meta expira em 24h. Em produção, usar token permanente de System User.
- Custos de referência (Brasil, 2026): template de utilidade custa cerca de R$ 0,035 por mensagem entregue. Desde 01/10/2026 as mensagens de serviço também são cobradas na mesma tarifa, mas as primeiras 1.000 por mês são grátis. Estimativa para ~100 candidatos ativos: R$ 100–180/mês no total com VPS.

## 6. Estrutura do repositório
```
docker-compose.yml          n8n + tunnel; monta ./data em /files dentro do n8n
.env.example                variáveis (copiar para .env — nunca commitar .env)
mock-inhire/server.js       InHire SIMULADO (API + painel + webhook)
data/inhire-mock/db.seed.json  vagas e candidaturas FICTÍCIAS do mock
data/contatos.json          (gerado, fora do git) último contato por candidatura
data/vagas.md               informações/FAQ das vagas (contexto do bot)
data/prompt-bot.md          regras e tom do bot, incluindo o marcador [ENCAMINHAR]
workflows/*.json            workflows do n8n para importar
docs/templates-whatsapp.md  textos dos templates para aprovação na Meta
README.md                   passo a passo de instalação e teste
```

### Variáveis de ambiente (`.env`)
`N8N_ENCRYPTION_KEY`, `WEBHOOK_URL`, `WA_ACCESS_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_VERIFY_TOKEN`, `WA_GRAPH_VERSION` (v23.0), `WA_TEMPLATE_UPDATE`, `WA_TEMPLATE_STAGE`, `WA_TEMPLATE_CLOSE`, `INHIRE_BASE_URL`, `INHIRE_API_TOKEN`, `INHIRE_WEBHOOK_SECRET`, `INHIRE_WEBHOOK_URL` (opcional, usado pelo mock), `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `RECRUITER_PHONE`, `UPDATE_INTERVAL_DAYS` (3).

## 7. Convenções para o agente
- Escreva textos para o usuário, comentários e mensagens em **português do Brasil**.
- **Nunca** commitar `.env`, tokens ou dados reais de candidatos (LGPD). Em `data/` ficam só dados fictícios; arquivos reais seguem o padrão `data/*.real.json` ou `data/real/`, que estão no `.gitignore`.
- Só envie mensagens para candidatos com `consentimento_whatsapp: true`.
- Os workflows precisam continuar **importáveis no n8n**: JSON válido e conexões apontando para nomes de nós que existem. Se renomear um nó, atualize `connections` e as referências `$('Nome do nó')`.
- Restrições dos nós Code (definidas no `docker-compose.yml`):
  - `require('fs')` só funciona por causa de `NODE_FUNCTION_ALLOW_BUILTIN=fs`, e o acesso a arquivos fica limitado a `/files` (`./data`).
  - `$env.X` só funciona porque `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`. Isso é aceitável no protótipo; em produção, migrar para Credentials do n8n.
  - Os nós devem retornar `[{ json: {...} }]`. Retornar `[]` interrompe o fluxo, e isso é usado de propósito como filtro.
- O bot **não decide** aprovação ou reprovação, não inventa informação e não pede dados sensíveis. As regras ficam em `data/prompt-bot.md`, e mudanças de comportamento devem ir para lá, não para o código.
- Toda a lógica de acesso ao InHire fica isolada nos nós `InHire: buscar candidaturas` / webhook `InHire: etapa mudou` e na função **`deInhire()`**, que converte o formato do InHire para o interno (`{ id, nome, telefone, vaga, etapa, consentimento_whatsapp }`). Ela está **copiada nos workflows 01, 02 e 03** (o n8n não compartilha código entre workflows sem sub-workflow): se mudar, mude nos três.
- Na integração real: trocar `INHIRE_BASE_URL`/`INHIRE_API_TOKEN`, ajustar `deInhire()`, a URL/paginação da busca e o formato/validação do webhook. O container `inhire-mock` pode ser removido.

## 8. Pendências e próximos passos
1. **[Bloqueante para a integração real; o desenvolvimento segue no mock]** Confirmar com o suporte do InHire se existe API pública ou webhooks de mudança de etapa, e se já há algo nativo de WhatsApp. O InHire tem o "RPO Virtual" com a Intera, que faz entrevista por WhatsApp com IA em vagas de alto volume. Também existe um conector de terceiros, a Unified.to, lançado em 02/11/2026, com autenticação por e-mail, senha e tenant.
   - Com webhook: tempo real. Só com API: consulta periódica (polling). Sem nenhum dos dois: exportação manual ou planilha.
2. Testar os dois workflows ponta a ponta com o número de teste.
3. Aprovar o template `atualizacao_processo` e trocar `WA_TEMPLATE_UPDATE`.
4. Dar memória de conversa ao bot (histórico por telefone).
5. Mudança de etapa: **feito no mock** (workflow 03, templates `mudanca_etapa` e `encerramento_processo`). Falta aprovar esses templates e o `entrevista_agendada` (precisa de data da entrevista, que o mock ainda não tem).
6. Coletar o consentimento do candidato para WhatsApp já na candidatura.
7. Produção: número próprio, Business Manager verificado (CNPJ), token permanente, VPS e Credentials do n8n no lugar de `$env`.
