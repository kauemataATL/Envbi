// InHire SIMULADO — finge ser a API do ATS enquanto a integração real não existe.
// Sem dependências: só Node (>= 18). O formato das respostas é NOSSO (o da API real ainda não é conhecido);
// quem traduz para o formato interno é o nó "adaptador" nos workflows do n8n.
//
// Rotas (todas em /api/v1 exigem "Authorization: Bearer <INHIRE_API_TOKEN>"):
//   GET   /api/v1/jobs                    lista as vagas
//   GET   /api/v1/applications            lista as candidaturas (com a vaga embutida)
//   GET   /api/v1/applications/:id        uma candidatura
//   PATCH /api/v1/applications/:id        { "stage": "..." } muda a etapa e dispara o webhook
//   POST  /api/v1/_reset                  volta os dados para o db.seed.json
//   GET   /                               painel simples para mudar etapas pelo navegador
//
// Webhook disparado na mudança de etapa:
//   POST INHIRE_WEBHOOK_URL   header "X-Inhire-Secret: <INHIRE_WEBHOOK_SECRET>"
//   { event: "application.stage_changed", occurredAt, data: { application, previousStage } }

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data', 'inhire-mock');
const SEED = path.join(DATA_DIR, 'db.seed.json');
const DB = path.join(DATA_DIR, 'db.json');
const TOKEN = process.env.INHIRE_API_TOKEN || '';
const WEBHOOK_URL = process.env.INHIRE_WEBHOOK_URL || '';
const WEBHOOK_SECRET = process.env.INHIRE_WEBHOOK_SECRET || '';

// ---------- dados ----------
function carregar() {
  if (!fs.existsSync(DB)) fs.copyFileSync(SEED, DB);
  return JSON.parse(fs.readFileSync(DB, 'utf8'));
}
function salvar(db) {
  fs.writeFileSync(DB, JSON.stringify(db, null, 2));
}
function expandir(db, app) {
  const job = db.jobs.find((j) => j.id === app.jobId);
  return { ...app, job: job ? { id: job.id, name: job.name } : null };
}

// ---------- webhook ----------
async function dispararWebhook(evento) {
  if (!WEBHOOK_URL) return { enviado: false, motivo: 'INHIRE_WEBHOOK_URL não configurada' };
  try {
    const r = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Inhire-Secret': WEBHOOK_SECRET },
      body: JSON.stringify(evento),
      signal: AbortSignal.timeout(10000),
    });
    const resultado = { enviado: r.ok, status: r.status };
    console.log(`[webhook] ${evento.event} ${evento.data.application.id} → ${WEBHOOK_URL} (${r.status})`);
    return resultado;
  } catch (e) {
    console.log(`[webhook] falhou: ${e.message}`);
    return { enviado: false, erro: e.message };
  }
}

// ---------- http ----------
function responder(res, status, corpo, tipo = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': tipo });
  res.end(typeof corpo === 'string' ? corpo : JSON.stringify(corpo, null, 2));
}
function lerCorpo(req) {
  return new Promise((ok, falha) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => {
      try { ok(s ? JSON.parse(s) : {}); } catch { falha(new Error('JSON inválido')); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname.replace(/\/+$/, '') || '/';

  try {
    if (req.method === 'GET' && p === '/') return responder(res, 200, PAINEL, 'text/html; charset=utf-8');
    if (req.method === 'GET' && p === '/health') return responder(res, 200, { ok: true });

    if (!p.startsWith('/api/v1/')) return responder(res, 404, { error: 'not_found' });
    if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) {
      return responder(res, 401, { error: 'unauthorized', message: 'Token inválido ou ausente' });
    }

    const db = carregar();

    if (req.method === 'GET' && p === '/api/v1/jobs') {
      return responder(res, 200, { data: db.jobs, total: db.jobs.length });
    }

    if (req.method === 'GET' && p === '/api/v1/applications') {
      const jobId = url.searchParams.get('jobId');
      const lista = db.applications.filter((a) => !jobId || a.jobId === jobId).map((a) => expandir(db, a));
      return responder(res, 200, { data: lista, total: lista.length });
    }

    const m = p.match(/^\/api\/v1\/applications\/([^/]+)$/);
    if (m) {
      const app = db.applications.find((a) => a.id === m[1]);
      if (!app) return responder(res, 404, { error: 'not_found', message: `Candidatura ${m[1]} não existe` });

      if (req.method === 'GET') return responder(res, 200, { data: expandir(db, app) });

      if (req.method === 'PATCH') {
        const corpo = await lerCorpo(req);
        const job = db.jobs.find((j) => j.id === app.jobId);
        if (!corpo.stage || !job.stages.includes(corpo.stage)) {
          return responder(res, 400, { error: 'invalid_stage', message: `Etapas válidas: ${job.stages.join(', ')}` });
        }
        const previousStage = app.stage;
        if (previousStage === corpo.stage) return responder(res, 200, { data: expandir(db, app), webhook: { enviado: false, motivo: 'etapa não mudou' } });

        app.stage = corpo.stage;
        app.updatedAt = new Date().toISOString();
        salvar(db);
        const webhook = await dispararWebhook({
          event: 'application.stage_changed',
          occurredAt: app.updatedAt,
          data: { application: expandir(db, app), previousStage },
        });
        return responder(res, 200, { data: expandir(db, app), webhook });
      }
    }

    if (req.method === 'POST' && p === '/api/v1/_reset') {
      fs.copyFileSync(SEED, DB);
      return responder(res, 200, { ok: true, message: 'Dados restaurados a partir do db.seed.json' });
    }

    return responder(res, 404, { error: 'not_found' });
  } catch (e) {
    console.error(e);
    return responder(res, 500, { error: 'internal_error', message: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`InHire simulado em http://localhost:${PORT}  (dados: ${DB})`);
  console.log(`Webhook de mudança de etapa → ${WEBHOOK_URL || '(desligado)'}`);
});

// ---------- painel (HTML) ----------
// O painel roda no navegador e chama a própria API; o token é injetado aqui porque é só um ambiente local de teste.
const PAINEL = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>InHire simulado</title>
<style>
  body{font-family:system-ui,sans-serif;margin:24px;color:#1f2937;background:#f9fafb}
  h1{font-size:20px;margin:0 0 4px} p{color:#6b7280;margin:0 0 16px}
  table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #e5e7eb}
  th,td{padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:left;font-size:14px}
  th{background:#f3f4f6} select,button{font:inherit;padding:4px 8px}
  #log{margin-top:16px;white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:12px;background:#111827;color:#d1fae5;padding:12px;border-radius:6px;min-height:40px}
</style></head><body>
<h1>InHire simulado</h1>
<p>Mude a etapa de um candidato: o mock grava a mudança e avisa o n8n pelo webhook. <button id="reset">Restaurar dados iniciais</button></p>
<table><thead><tr><th>Candidato</th><th>Telefone</th><th>Vaga</th><th>WhatsApp</th><th>Etapa</th><th></th></tr></thead><tbody id="linhas"></tbody></table>
<div id="log">Pronto.</div>
<script>
const H = { 'Authorization': 'Bearer ${TOKEN}', 'Content-Type': 'application/json' };
const log = (t) => document.getElementById('log').textContent = t;
async function carregar() {
  const [jobs, apps] = await Promise.all([
    fetch('/api/v1/jobs', { headers: H }).then(r => r.json()),
    fetch('/api/v1/applications', { headers: H }).then(r => r.json()),
  ]);
  const tb = document.getElementById('linhas'); tb.innerHTML = '';
  for (const a of apps.data) {
    const job = jobs.data.find(j => j.id === a.jobId);
    const tr = document.createElement('tr');
    const opts = job.stages.map(s => '<option' + (s === a.stage ? ' selected' : '') + '>' + s + '</option>').join('');
    tr.innerHTML = '<td>' + a.talent.name + '</td><td>' + a.talent.phone + '</td><td>' + a.job.name + '</td><td>' +
      (a.customFields.consentimento_whatsapp ? 'sim' : 'não') + '</td><td><select>' + opts + '</select></td><td><button>Mudar etapa</button></td>';
    tr.querySelector('button').onclick = async () => {
      const stage = tr.querySelector('select').value;
      const r = await fetch('/api/v1/applications/' + a.id, { method: 'PATCH', headers: H, body: JSON.stringify({ stage }) });
      log(JSON.stringify(await r.json(), null, 2)); carregar();
    };
    tb.appendChild(tr);
  }
}
document.getElementById('reset').onclick = async () => {
  const r = await fetch('/api/v1/_reset', { method: 'POST', headers: H });
  log(JSON.stringify(await r.json(), null, 2)); carregar();
};
carregar().catch(e => log('Erro: ' + e.message));
</script></body></html>`;
