// Netlify Function: whatsapp-webhook.js
// URL de callback do WhatsApp E das mensagens diretas (Meta for Developers ›
// WhatsApp / Instagram / Messenger › Webhooks), todas no mesmo endereço:
//   https://<site>/.netlify/functions/whatsapp-webhook
// object "whatsapp_business_account" → WhatsApp; "instagram" → Direct;
// "page" → Messenger (campo messages). Ver netlify/lib/meta-dm.js.
// GET  = verificação da Meta (hub.verify_token = WA_VERIFY_TOKEN).
// POST = eventos: mensagens recebidas, status de envio e (coexistência)
//        mensagens enviadas pela equipe no app do celular (smb_message_echoes).
// Grava tudo no Supabase e dispara wa-responder-background para a IA.
// Responde 200 rápido (a Meta reenvia se demorar).

const crypto = require('crypto');
const DM = require('../lib/meta-dm');
const SITE = process.env.URL || 'https://condux-atendimento.netlify.app';
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const VERIFY = process.env.WA_VERIFY_TOKEN;
const SBH = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' };

async function sb(path, opt = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...opt, headers: { ...SBH, ...(opt.headers || {}) } });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
const log = (msg, nivel = 'info') => sb('wa_log', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ msg: String(msg).slice(0, 2000), nivel }) }).catch(() => {});

function assinaturaOk(event) {
  const segredo = process.env.META_APP_SECRET;
  if (!segredo) return true; // sem segredo configurado: aceita (registrado no log)
  const sig = event.headers['x-hub-signature-256'] || event.headers['X-Hub-Signature-256'] || '';
  const corpo = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : Buffer.from(event.body || '', 'utf8');
  const esperado = 'sha256=' + crypto.createHmac('sha256', segredo).update(corpo).digest('hex');
  try { return sig.length === esperado.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado)); } catch (e) { return false; }
}

function textoDe(m) {
  switch (m.type) {
    case 'text': return m.text && m.text.body;
    case 'button': return m.button && m.button.text;
    case 'interactive': return (m.interactive && (m.interactive.button_reply || m.interactive.list_reply || {}).title) || '[resposta interativa]';
    case 'image': return m.image && m.image.caption ? `[imagem] ${m.image.caption}` : '[imagem]';
    case 'video': return m.video && m.video.caption ? `[vídeo] ${m.video.caption}` : '[vídeo]';
    case 'audio': return '[áudio]';
    case 'document': return `[documento] ${(m.document && m.document.filename) || ''}`.trim();
    case 'sticker': return '[figurinha]';
    case 'location': return '[localização]';
    case 'reaction': return m.reaction ? `[reação ${m.reaction.emoji || ''}]` : '[reação]';
    default: return `[${m.type}]`;
  }
}

// Mídia do WhatsApp: guarda o ID (baixado depois pela função wa-midia)
function midiaWA(m) {
  const x = ['image', 'audio', 'video', 'document', 'sticker'].includes(m.type) && m[m.type];
  return x && x.id ? { midia_id: x.id, midia_mime: x.mime_type || null } : {};
}

async function garantirConversa(wa_id, nome, campos) {
  await sb('wa_conversas?on_conflict=wa_id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ wa_id, ...(nome ? { nome } : {}), ...campos })
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'GET') {
    const q = event.queryStringParameters || {};
    if (VERIFY && q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === VERIFY) return { statusCode: 200, body: q['hub.challenge'] || '' };
    return { statusCode: 403, body: 'forbidden' };
  }
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: '' };
  if (!assinaturaOk(event)) { await log('Webhook com assinatura inválida — ignorado.', 'erro'); return { statusCode: 401, body: '' }; }
  if (!process.env.META_APP_SECRET && !global.__avisouSecret) { global.__avisouSecret = true; await log('Aviso: META_APP_SECRET não configurado — assinatura do webhook não verificada.', 'aviso'); }

  let body; try { body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body); } catch (e) { return { statusCode: 200, body: '' }; }
  const disparar = new Set();
  // ------------------ Direct do Instagram / Messenger ------------------
  if (body.object === 'instagram' || body.object === 'page') {
    try {
      const evs = DM.eventosDM(body);
      await log(`[DM] webhook recebido: ${DM.resumoWebhook(body)} → ${evs.length} mensagem(ns)`);
      const ecos = [];
      for (const ev of evs) {
        if (ev.eco) { if (!ev.doNossoApp) ecos.push(ev); continue; }
        const existente = (await sb(`wa_conversas?wa_id=eq.${encodeURIComponent(ev.wa_id)}&select=nome`))[0];
        const pf = existente && existente.nome ? {} : await DM.perfil(ev.wa_id);
        await garantirConversa(ev.wa_id, pf.nome, { canal: ev.canal, ...(pf.usuario ? { usuario: pf.usuario } : {}), ultima_msg_em: ev.em, ultima_cliente_em: ev.em });
        const ins = await sb('wa_mensagens?on_conflict=id', {
          method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
          body: JSON.stringify({ id: ev.id, wa_id: ev.wa_id, direcao: 'in', autor: 'cliente', tipo: ev.tipo, texto: ev.texto, status: 'recebida', criado_em: ev.em, midia_url: ev.midia_url || null, midia_mime: ev.midia_mime || null })
        });
        if (ins && ins.length) {
          await sb('rpc/wa_incrementa_nao_lidas', { method: 'POST', body: JSON.stringify({ p_wa_id: ev.wa_id }) }).catch(() => {});
          disparar.add(ev.wa_id);
        }
      }
      // Eco = mensagem enviada pela conta da Condux. Se não foi a IA/painel
      // (id ainda não gravado), foi a equipe pelo app do Instagram/Facebook → IA pausa.
      if (ecos.length) await new Promise(r => setTimeout(r, 2500));
      for (const ev of ecos) {
        const ja = await sb(`wa_mensagens?id=eq.${encodeURIComponent(ev.id)}&select=id`);
        if (ja.length) continue;
        const conv = (await sb(`wa_conversas?wa_id=eq.${encodeURIComponent(ev.wa_id)}&select=wa_id`))[0];
        if (!conv) continue; // conversa que não passou pelo painel
        await garantirConversa(ev.wa_id, null, { ultima_msg_em: ev.em, modo: 'humano', humano_desde: ev.em, motivo_humano: 'equipe respondeu pelo app' });
        await sb('wa_mensagens?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify({ id: ev.id, wa_id: ev.wa_id, direcao: 'out', autor: 'equipe_app', tipo: ev.tipo, texto: ev.texto, status: 'enviada', criado_em: ev.em }) });
      }
    } catch (e) { await log(`Webhook DM: ${e.message}`, 'erro'); }
    for (const wa_id of disparar) {
      try { await fetch(`${SITE}/.netlify/functions/wa-responder-background?wa_id=${encodeURIComponent(wa_id)}`, { headers: require('../lib/guarda').cabecalhoInterno() }); } catch (e) {}
    }
    return { statusCode: 200, body: '' };
  }
  try {
    const cfgNum = ((await sb('wa_config?id=eq.1&select=phone_number_id').catch(() => [{}]))[0] || {}).phone_number_id;
    for (const entry of body.entry || []) for (const ch of entry.changes || []) {
      const v = ch.value || {};
      // Só o número configurado no painel (ignora o número de teste antigo etc.)
      if (cfgNum && v.metadata && v.metadata.phone_number_id && v.metadata.phone_number_id !== cfgNum) continue;
      const nomes = Object.fromEntries((v.contacts || []).map(c => [c.wa_id, c.profile && c.profile.name]));

      // 1) Mensagens do cliente
      for (const m of v.messages || []) {
        const agora = new Date((Number(m.timestamp) || Date.now() / 1000) * 1000).toISOString();
        await garantirConversa(m.from, nomes[m.from], { ultima_msg_em: agora, ultima_cliente_em: agora });
        const ins = await sb('wa_mensagens?on_conflict=id', {
          method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
          body: JSON.stringify({ id: m.id, wa_id: m.from, direcao: 'in', autor: 'cliente', tipo: m.type, texto: textoDe(m), status: 'recebida', criado_em: agora, ...midiaWA(m) })
        });
        if (ins && ins.length) { // nova (a Meta pode reenviar)
          await sb(`rpc/wa_incrementa_nao_lidas`, { method: 'POST', body: JSON.stringify({ p_wa_id: m.from }) }).catch(() => {});
          if (m.type !== 'reaction') disparar.add(m.from);
        }
      }
      // 2) Status das mensagens enviadas
      for (const s of v.statuses || []) {
        const st = { sent: 'enviada', delivered: 'entregue', read: 'lida', failed: 'erro' }[s.status] || s.status;
        const upd = { status: st };
        if (s.errors && s.errors.length) {
          const c = s.errors[0].code;
          upd.erro = c === 131047
            ? '131047: fora da janela de 24h — o cliente precisa mandar mensagem para este número antes (ou usar um modelo aprovado)'
            : `${c}: ${s.errors[0].title || s.errors[0].message || ''}`.slice(0, 300);
        }
        const upRows = await sb(`wa_mensagens?id=eq.${encodeURIComponent(s.id)}&status=not.in.(lida)`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(upd) }).catch(() => []);
        // Mensagem da equipe que falhou: não deixa a IA pausada à toa
        const r0 = upRows && upRows[0];
        if (st === 'erro' && r0 && r0.autor === 'equipe') {
          await sb(`wa_conversas?wa_id=eq.${encodeURIComponent(r0.wa_id)}&modo=eq.humano`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ modo: 'ia', humano_desde: null, motivo_humano: null }) }).catch(() => {});
        }
      }
      // 3) Coexistência: mensagem enviada pela equipe no app do celular → IA pausa
      for (const m of v.message_echoes || []) {
        const agora = new Date((Number(m.timestamp) || Date.now() / 1000) * 1000).toISOString();
        await garantirConversa(m.to, null, { ultima_msg_em: agora, modo: 'humano', humano_desde: agora, motivo_humano: 'equipe respondeu pelo app' });
        await sb('wa_mensagens?on_conflict=id', {
          method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
          body: JSON.stringify({ id: m.id, wa_id: m.to, direcao: 'out', autor: 'equipe_app', tipo: m.type, texto: textoDe(m), status: 'enviada', criado_em: agora })
        });
      }
    }
  } catch (e) { await log(`Webhook: ${e.message}`, 'erro'); }

  for (const wa_id of disparar) {
    try { await fetch(`${SITE}/.netlify/functions/wa-responder-background?wa_id=${encodeURIComponent(wa_id)}`, { headers: require('../lib/guarda').cabecalhoInterno() }); } catch (e) {}
  }
  return { statusCode: 200, body: '' };
};
