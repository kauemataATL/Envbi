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
- **InHire ainda NÃO está integrado.** Os candidatos vêm de `data/candidatos.json` (dados fictícios que simulam o InHire).
- Os workflows foram gerados, mas **ainda não foram testados ponta a ponta** no n8n.
- O bot **não tem memória**: cada mensagem é respondida isoladamente.

## 3. Fluxo geral
```
InHire (vagas, candidatos, etapas)        ← hoje: data/candidatos.json
        │  (API/webhook — a confirmar)
        ▼
n8n (orquestrador, JavaScript nos nós Code)
   ├─ Workflow 01: Bot ◄──── webhook ──── WhatsApp Cloud API (Meta) ◄── candidato
   │      └─ Claude (API Anthropic) gera a resposta ──► WhatsApp ──► candidato
   │                                                   └─► alerta p/ recrutadora
   └─ Workflow 02: Agendador diário 9h ──► templates ──► WhatsApp ──► candidatos
```

### Workflow 01 — Bot (`workflows/01-bot-whatsapp.json`)
1. **GET `/webhook/whatsapp`**: verificação da Meta (compara `hub.verify_token` com `WA_VERIFY_TOKEN` e devolve `hub.challenge`).
2. **POST `/webhook/whatsapp`**: chega a mensagem. O nó `Extrair mensagem` ignora eventos de status (entregue, lido). Mensagens que não são texto viram uma instrução para a IA pedir que o candidato escreva.
3. `Montar contexto`: lê `prompt-bot.md`, `vagas.md` e `candidatos.json` e acha o candidato pelos **8 últimos dígitos** do telefone. Isso é necessário porque, no Brasil, o WhatsApp às vezes manda o número sem o 9 extra.
4. `Perguntar à IA (Claude)`: faz `POST https://api.anthropic.com/v1/messages` com o modelo `ANTHROPIC_MODEL` (padrão `claude-haiku-5-5`).
5. `Preparar envios`: se a resposta começar com `[ENCAMINHAR]`, o marcador é removido e um alerta é enviado para `RECRUITER_PHONE`.
6. `Enviar WhatsApp`: faz `POST graph.facebook.com/{versão}/{PHONE_NUMBER_ID}/messages`.

### Workflow 02 — Atualizações (`workflows/02-atualizacoes-3-dias.json`)
1. Gatilho: **todo dia às 9h** (America/Sao_Paulo), mais um gatilho manual para teste.
2. `Selecionar candidatos`: seleciona quem tem `consentimento_whatsapp: true`, não está em etapa final (`Contratado`, `Reprovado`, `Desistiu`) e está há `UPDATE_INTERVAL_DAYS` dias ou mais sem contato (ou nunca recebeu contato).
3. `Enviar template`: usa o template `WA_TEMPLATE_UPDATE`. `hello_world` é o template de teste; os reais usam as variáveis {{1}} nome, {{2}} vaga e {{3}} etapa. O nó usa `onError: continueRegularOutput`.
4. `Registrar contato`: grava `ultimo_contato` no JSON para quem recebeu a mensagem com sucesso.

## 4. Ferramentas e decisões
| Item | Escolha | Por quê |
|---|---|---|
| Orquestrador | **n8n** Community (self-hosted, grátis) | Integração visual; a recrutadora consegue entender o fluxo |
| Linguagem | **JavaScript** nos nós Code do n8n | É o padrão nativo do n8n. **Se o projeto crescer → migrar para TypeScript/Node** |
| WhatsApp | **WhatsApp Cloud API oficial (Meta)** | APIs não oficiais podem fazer o número ser banido e são um risco de LGPD. **Não usar.** |
| IA | **Claude (API Anthropic)** | Respostas do bot |
| Ambiente local | **Docker Compose** | n8n + `cloudflared` |
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
data/candidatos.json        candidatos FICTÍCIOS (simula o InHire)
data/vagas.md               informações/FAQ das vagas (contexto do bot)
data/prompt-bot.md          regras e tom do bot, incluindo o marcador [ENCAMINHAR]
workflows/*.json            workflows do n8n para importar
docs/templates-whatsapp.md  textos dos templates para aprovação na Meta
README.md                   passo a passo de instalação e teste
```

### Variáveis de ambiente (`.env`)
`N8N_ENCRYPTION_KEY`, `WEBHOOK_URL`, `WA_ACCESS_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_VERIFY_TOKEN`, `WA_GRAPH_VERSION` (v23.0), `WA_TEMPLATE_UPDATE`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `RECRUITER_PHONE`, `UPDATE_INTERVAL_DAYS` (3).

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
- Toda a lógica de acesso ao InHire deve ficar isolada (hoje, nos nós que leem `candidatos.json`), para que a troca pela API real seja localizada.

## 8. Pendências e próximos passos
1. **[Bloqueante]** Confirmar com o suporte do InHire se existe API pública ou webhooks de mudança de etapa, e se já há algo nativo de WhatsApp. O InHire tem o "RPO Virtual" com a Intera, que faz entrevista por WhatsApp com IA em vagas de alto volume. Também existe um conector de terceiros, a Unified.to, lançado em 02/11/2026, com autenticação por e-mail, senha e tenant.
   - Com webhook: tempo real. Só com API: consulta periódica (polling). Sem nenhum dos dois: exportação manual ou planilha.
2. Testar os dois workflows ponta a ponta com o número de teste.
3. Aprovar o template `atualizacao_processo` e trocar `WA_TEMPLATE_UPDATE`.
4. Dar memória de conversa ao bot (histórico por telefone).
5. Enviar mensagem imediata quando o candidato mudar de etapa (templates `mudanca_etapa`, `entrevista_agendada` e `encerramento_processo`).
6. Coletar o consentimento do candidato para WhatsApp já na candidatura.
7. Produção: número próprio, Business Manager verificado (CNPJ), token permanente, VPS e Credentials do n8n no lugar de `$env`.
