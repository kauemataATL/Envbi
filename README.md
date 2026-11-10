# InHire + WhatsApp — automação de atendimento a candidatos

Protótipo **local** (custo só da IA) com dois fluxos no n8n:

1. **Bot** — candidato manda mensagem no WhatsApp → IA (Claude) responde usando os dados da vaga e a etapa do candidato → se precisar, avisa a recrutadora.
2. **Atualizações** — todo dia às 9h, quem está há 3+ dias sem contato recebe uma atualização sobre a vaga.

Enquanto o acesso à API do InHire não é confirmado, os candidatos vêm de `data/candidatos.json` (dados fictícios). Depois, só trocamos essa fonte.

```
inhire-whatsapp/
├── docker-compose.yml        # n8n + túnel público gratuito (Cloudflare)
├── .env.example              # modelo das chaves → copiar para .env
├── data/                     # o n8n enxerga esta pasta como /files
│   ├── candidatos.json       # candidatos FICTÍCIOS (simula o InHire)
│   ├── vagas.md              # informações/FAQ das vagas usadas pelo bot
│   └── prompt-bot.md         # personalidade e regras do bot
├── workflows/
│   ├── 01-bot-whatsapp.json
│   └── 02-atualizacoes-3-dias.json
└── docs/templates-whatsapp.md  # textos dos templates para aprovar na Meta
```

---

## Pré-requisitos
- **Docker Desktop** (Windows): https://www.docker.com/products/docker-desktop — instale e deixe aberto
- **Git**
- Conta no **Meta for Developers** (https://developers.facebook.com) — pode usar seu Facebook
- Chave da **API da Anthropic** (https://console.anthropic.com → API Keys) com alguns dólares de crédito

## Passo 1 — Configurar o projeto
```powershell
cd $HOME\Downloads\inhire-whatsapp
copy .env.example .env
git init
git add .
git commit -m "Estrutura inicial"
```
Abra o `.env` no VS Code e preencha `N8N_ENCRYPTION_KEY` e `ANTHROPIC_API_KEY` (o resto vem nos próximos passos).

## Passo 2 — Criar o app do WhatsApp na Meta
1. developers.facebook.com → **Meus apps → Criar app** → caso de uso **"Conectar-se com clientes pelo WhatsApp"** (ou tipo *Business*).
2. No menu do app: **WhatsApp → Configuração da API (API Setup)**.
3. Você recebe um **número de teste** grátis. Copie para o `.env`:
   - **Token de acesso temporário** → `WA_ACCESS_TOKEN` (expira em 24h; gere outro quando expirar)
   - **Phone number ID** → `WA_PHONE_NUMBER_ID`
4. Em **"Para" (To)**, adicione o **seu número** (e o da sua amiga). O número de teste só envia para até 5 números cadastrados.
5. Clique em **Enviar mensagem** para testar — deve chegar um "Hello World" no seu WhatsApp.
6. Responda qualquer coisa a essa mensagem pelo seu WhatsApp (isso abre a janela de 24h para o bot responder texto livre).

## Passo 3 — Subir o n8n e o túnel
```powershell
docker compose up -d
docker compose logs tunnel
```
Nos logs, procure uma linha com `https://alguma-coisa.trycloudflare.com` — essa é sua **URL pública**.
- Abra http://localhost:5678 e crie sua conta local do n8n.

> A URL do túnel muda sempre que o container `tunnel` reinicia. Se mudar, atualize no painel da Meta (passo 5).

## Passo 4 — Importar os workflows
No n8n: **Create workflow → menu "…" → Import from File** → escolha `workflows/01-bot-whatsapp.json`. Salve.
Repita para `workflows/02-atualizacoes-3-dias.json`.

Depois **ative (Publish/Active)** o workflow do bot — o webhook de produção só funciona com ele ativo.

## Passo 5 — Ligar o WhatsApp ao n8n (webhook)
No painel da Meta: **WhatsApp → Configuração (Configuration) → Webhook → Editar**
- **URL de callback:** `https://SUA-URL.trycloudflare.com/webhook/whatsapp`
- **Token de verificação:** o mesmo valor de `WA_VERIFY_TOKEN` do seu `.env`
- Clique em **Verificar e salvar**, depois em **Campos do webhook** assine **`messages`**.

## Passo 6 — Testar
**Bot:** em `data/candidatos.json`, troque o telefone do candidato `c001` pelo seu (formato `55` + DDD + número). Mande uma mensagem para o número de teste, ex.: *"Oi, em que etapa eu estou?"*. Acompanhe em **Executions** no n8n.

**Atualizações:** abra o workflow 02 e clique em **Test workflow** (gatilho manual). Seu número deve receber o `hello_world` e o campo `ultimo_contato` é gravado no JSON. Rodar de novo não reenvia (só depois de 3 dias).
Para testar de novo, apague o valor de `ultimo_contato` (deixe `null`).

## Passo 7 — Template de verdade
Cadastre `atualizacao_processo` (texto em `docs/templates-whatsapp.md`). Após aprovado, troque no `.env`:
```
WA_TEMPLATE_UPDATE=atualizacao_processo
```
e reinicie: `docker compose up -d n8n`.

---

## Mudou o .env?
Sempre que alterar o `.env`, rode `docker compose up -d n8n` para o n8n ler os novos valores.

## Problemas comuns
| Sintoma | Causa provável |
|---|---|
| Meta não verifica o webhook | Workflow do bot não está ativo, URL do túnel mudou, ou token diferente do `.env` |
| Erro 401/190 ao enviar | `WA_ACCESS_TOKEN` expirou (o temporário dura 24h) |
| Erro 131030 "recipient not in allowed list" | Número não cadastrado em "Para" no API Setup. No Brasil, tente cadastrar com e sem o 9 |
| Erro 131047 / mensagem não chega | Fora da janela de 24h: o candidato precisa ter escrito antes, senão só vai template |
| Bot responde "não encontrei sua candidatura" | Telefone no `candidatos.json` diferente do seu (o match usa os 8 últimos dígitos) |
| "Cannot find module 'fs'" ou acesso a `$env` negado | Variáveis `NODE_FUNCTION_ALLOW_BUILTIN` / `N8N_BLOCK_ENV_ACCESS_IN_NODE` não aplicadas: `docker compose up -d --force-recreate n8n` |
| Alerta para a recrutadora não chega | A recrutadora precisa ter mandado mensagem ao número nas últimas 24h (texto livre só dentro da janela) |

## Segurança e LGPD
- `.env` nunca vai para o git (já está no `.gitignore`).
- Na fase local use **somente dados fictícios**. Dados reais de candidatos só no servidor definitivo e com autorização.
- Só envie mensagens para quem deu consentimento (`consentimento_whatsapp: true`).

## Próximos passos
- [ ] Confirmar com o InHire: API pública? webhooks de mudança de etapa? → trocar `data/candidatos.json` pela API
- [ ] Memória de conversa no bot (hoje cada mensagem é respondida isoladamente)
- [ ] Mensagem imediata quando o candidato muda de etapa (templates 2, 3 e 4)
- [ ] Migrar credenciais do `$env` para Credentials do n8n
- [ ] Número próprio + Business Manager verificado (CNPJ) + token permanente
- [ ] Subir numa VPS (exportar/importar os workflows)
