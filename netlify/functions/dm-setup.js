// Netlify Function: dm-setup.js — Direct do Instagram + Messenger (só painel logado).
//   GET               → diagnóstico: Página, conta do IG, permissões do META_TOKEN,
//                       apps inscritos na Página
//   POST {acao:'assinar'} → inscreve o app na Página para receber mensagens
//                       (subscribed_fields=messages,message_echoes)
const DM = require('../lib/meta-dm');
const { proteger } = require('../lib/guarda');
const GV = process.env.META_API_VERSION || 'v23.0';
const G = `https://graph.facebook.com/${GV}`;
const json = (c, b) => ({ statusCode: c, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(b) });
const gget = async (path) => { const r = await fetch(`${G}/${path}`); const j = await r.json().catch(() => ({})); return j; };

const handler = async (event) => {
  try {
    const tk = process.env.META_TOKEN;
    const p = await DM.pagina();
    let corpo = {}; try { corpo = JSON.parse(event.body || '{}'); } catch (e) {}
    if (event.httpMethod === 'POST' && corpo.acao === 'assinar') {
      const r = await fetch(`${G}/${p.pageId}/subscribed_apps`, {
        method: 'POST', body: new URLSearchParams({ subscribed_fields: 'messages,message_echoes', access_token: p.pageToken })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) return json(400, { erro: (j.error && j.error.message) || r.status });
    }
    const dbg = await gget(`debug_token?input_token=${encodeURIComponent(tk)}&access_token=${encodeURIComponent(tk)}`);
    const escopos = (dbg.data && dbg.data.scopes) || [];
    const inscritos = await gget(`${p.pageId}/subscribed_apps?access_token=${encodeURIComponent(p.pageToken)}`);
    const ig = p.igId ? await gget(`${p.igId}?fields=username&access_token=${encodeURIComponent(p.pageToken)}`) : null;
    return json(200, {
      pagina: p.pageId, instagram: ig && (ig.username || ig.error && ig.error.message),
      permissoes_mensagens: { pages_messaging: escopos.includes('pages_messaging'), instagram_manage_messages: escopos.includes('instagram_manage_messages') },
      escopos, apps_inscritos_na_pagina: (inscritos.data || []).map(a => ({ app: a.name || a.id, campos: a.subscribed_fields })),
      erro_inscritos: inscritos.error && inscritos.error.message
    });
  } catch (e) { return json(500, { erro: e.message }); }
};
exports.handler = proteger(handler);
