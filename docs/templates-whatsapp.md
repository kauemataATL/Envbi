# Templates para aprovar na Meta

Mensagens que **a empresa inicia** (fora da janela de 24h após o candidato escrever) precisam ser templates aprovados.
Cadastre em: **WhatsApp Manager > Modelos de mensagem > Criar modelo**
- Categoria: **Utilidade** (mais barata que Marketing; não coloque nada promocional, senão a Meta reclassifica)
- Idioma: **Português (BR)** → código `pt_BR`
- As variáveis `{{1}}`, `{{2}}`... precisam de exemplos na hora do cadastro.

---

## 1. `atualizacao_processo` — o envio a cada 3 dias (já ligado no workflow 02)
> Olá, {{1}}! Passando para te atualizar sobre o processo seletivo da vaga **{{2}}**: no momento você está na etapa **{{3}}**. Assim que houver novidades, avisamos por aqui. Se tiver alguma dúvida, é só responder esta mensagem.

Exemplos: `{{1}}` Mariana · `{{2}}` Analista de Atendimento · `{{3}}` Entrevista com RH

Depois de aprovado, troque no `.env`: `WA_TEMPLATE_UPDATE=atualizacao_processo`

## 2. `mudanca_etapa` — quando o candidato avança (próxima fase do projeto)
> Boa notícia, {{1}}! Você avançou no processo da vaga **{{2}}** e agora está na etapa **{{3}}**. Em breve enviaremos os próximos passos.

## 3. `entrevista_agendada`
> Olá, {{1}}! Sua entrevista para a vaga **{{2}}** está agendada para **{{3}}**. O link/endereço foi enviado para o seu e-mail. Responda **CONFIRMO** para confirmar sua presença.

## 4. `encerramento_processo` — retorno de não aprovação
> Olá, {{1}}. Agradecemos muito sua participação no processo da vaga **{{2}}**. Neste momento seguiremos com outros perfis, mas seu currículo continua no nosso banco de talentos para futuras oportunidades. Desejamos muito sucesso!
