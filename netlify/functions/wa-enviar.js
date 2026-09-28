// Netlify Function: wa-enviar.js  (POST {wa_id, texto})
// Resposta da EQUIPE pela caixa de conversas do painel. Só envia para quem
// escreveu nas últimas 24h (regra do WhatsApp e trava contra abuso), coloca a
// conversa em modo "humano" (a IA pausa) e grava a mensagem.
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const GV = process.env.META_API_VERSION || 'v23.0';
const SBH = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' };
const sb = async (p, o = {}) => { const r = await fetch(`${SB_URL}/rest/v1/${p}`, { ...o, headers: { ...SBH, ...(o.headers || {}) } }); const t = await r.text(); if (!r.ok) throw new Error(t.slice(0, 200)); return t ? JSON.parse(t) : null; };
const { usuarioDoPainel } = require('../lib/painel-auth');
const DM = require('../lib/meta-dm');
const resp = (c, b) => ({ statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return resp(405, { erro: 'use POST' });
  const quem = await usuarioDoPainel(event);
  if (!quem) return resp(401, { erro: 'Faça login no painel para enviar mensagens.' });
  let b; try { b = JSON.parse(event.body || '{}'); } catch (e) { return resp(400, { erro: 'JSON inválido' }); }
  const bruto = String(b.wa_id || '');
  const wa_id = /^(ig|fb)_\d+$/.test(bruto) ? bruto : bruto.replace(/\D/g, ''); const texto = String(b.texto || '').trim();
  if (!wa_id || !texto || texto.length > 3000) return resp(400, { erro: 'wa_id e texto obrigatórios' });
  try {
    const cfg = (await sb('wa_config?id=eq.1&select=*'))[0];
    const conv = (await sb(`wa_conversas?wa_id=eq.${encodeURIComponent(wa_id)}&select=*`))[0];
    if (!conv) return resp(404, { erro: 'conversa não encontrada' });
    if (!conv.ultima_cliente_em || Date.now() - new Date(conv.ultima_cliente_em) > 24 * 3600 * 1000)
      return resp(409, { erro: 'Passaram 24h desde a última mensagem do cliente. O WhatsApp só permite responder com mensagem de modelo aprovada; no Instagram/Messenger a Meta bloqueia respostas depois de 24h.' });
    let msgId;
    if (DM.ehDM(wa_id)) {
      try { msgId = (await DM.enviarDM(wa_id, texto)).id; } catch (e) { return resp(502, { erro: e.message }); }
    } else {
      const r = await fetch(`https://graph.facebook.com/${GV}/${cfg.phone_number_id}/messages`, {
        method: 'POST', headers: { Authorization: `Bearer ${process.env.WA_TOKEN || process.env.META_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: wa_id, type: 'text', text: { preview_url: true, body: texto } })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) return resp(502, { erro: (j.error && (j.error.error_user_msg || j.error.message)) || `WhatsApp ${r.status}` });
      msgId = j.messages[0].id;
    }
    const agora = new Date().toISOString();
    await sb('wa_mensagens?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: msgId, wa_id, direcao: 'out', autor: 'equipe', tipo: 'text', texto, erro: null, categoria: quem.email, status: 'enviada', criado_em: agora }) });
    await sb(`wa_mensagens?wa_id=eq.${encodeURIComponent(wa_id)}&direcao=eq.in&status=eq.recebida`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'respondida' }) });
    await sb(`wa_conversas?wa_id=eq.${encodeURIComponent(wa_id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ modo: 'humano', humano_desde: conv.modo === 'humano' ? conv.humano_desde : agora, motivo_humano: conv.motivo_humano || 'equipe assumiu pelo painel', ultima_msg_em: agora, nao_lidas: 0 }) });
    return resp(200, { ok: true });
  } catch (e) { return resp(500, { erro: e.message }); }
};
