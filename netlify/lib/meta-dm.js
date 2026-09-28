// Mensagens diretas: Direct do Instagram e Messenger do Facebook.
// Usam as MESMAS tabelas do WhatsApp (wa_conversas / wa_mensagens), com
// wa_id prefixado:  ig_<IGSID>  (Instagram)  ·  fb_<PSID>  (Messenger)
// e a coluna wa_conversas.canal = 'instagram' | 'messenger' | 'whatsapp'.
// Envio pela API de Mensagens da Meta (POST /{page-id}/messages) com o token
// da Página, obtido a partir do META_TOKEN (usuário do sistema).
const GV = process.env.META_API_VERSION || 'v23.0';
const G = `https://graph.facebook.com/${GV}`;
const APP_ID = process.env.META_APP_ID;

const canalDe = id => /^ig_/.test(id) ? 'instagram' : /^fb_/.test(id) ? 'messenger' : 'whatsapp';
const ehDM = id => canalDe(id) !== 'whatsapp';
const idDestino = id => String(id).replace(/^(ig|fb)_/, '');
const NOME_CANAL = { whatsapp: 'WhatsApp', instagram: 'Direct do Instagram', messenger: 'Messenger do Facebook' };

// Texto de uma mensagem recebida (message do webhook)
function textoDM(msg) {
  if (!msg) return '';
  const partes = [];
  if (msg.reply_to && msg.reply_to.story) partes.push('[respondeu ao seu story]');
  for (const a of msg.attachments || []) {
    const t = a.type;
    partes.push(t === 'story_mention' ? '[mencionou a Condux no story]' : t === 'image' ? '[imagem]' : t === 'video' ? '[vídeo]' : t === 'audio' ? '[áudio]' : t === 'share' || t === 'ig_reel' || t === 'reel' ? '[compartilhou uma publicação]' : t === 'fallback' ? '[link]' : `[${t}]`);
  }
  if (msg.text) partes.push(msg.text);
  if (msg.is_unsupported) partes.push('[mensagem não suportada]');
  return partes.join(' ').trim() || '[mensagem]';
}

// Primeira mídia da mensagem (foto, vídeo, áudio) — URL temporária do CDN da Meta
function midiaDM(msg) {
  const a = (msg.attachments || []).find(x => ['image', 'video', 'audio', 'file'].includes(x.type) && x.payload && x.payload.url);
  if (!a) return {};
  return { midia_url: a.payload.url, midia_mime: { image: 'image/jpeg', video: 'video/mp4', audio: 'audio/mp4', file: 'application/octet-stream' }[a.type] };
}

// Converte o corpo do webhook (object instagram | page) em eventos simples.
// paginaIds: ids da própria conta (Página e conta do IG) para identificar ecos.
function eventosDM(body) {
  const canal = body.object === 'instagram' ? 'instagram' : body.object === 'page' ? 'messenger' : null;
  if (!canal) return [];
  const pre = canal === 'instagram' ? 'ig_' : 'fb_';
  const out = [];
  // Formato real: entry[].messaging[]. Formato do botão "Teste" do painel da Meta
  // e de algumas assinaturas: entry[].changes[{field:'messages', value:{...}}].
  const lista = [];
  for (const entry of body.entry || []) {
    for (const ev of entry.messaging || []) lista.push(ev);
    for (const ch of entry.changes || []) if (ch.field === 'messages' && ch.value) lista.push(ch.value);
  }
  for (const ev of lista) {
    const m = ev.message; if (!m || !m.mid) continue;          // ignora leituras, reações, postbacks
    const eco = !!m.is_echo;
    const cliente = eco ? ev.recipient && ev.recipient.id : ev.sender && ev.sender.id;
    if (!cliente) continue;
    out.push({
      canal, wa_id: pre + cliente, id: m.mid, eco, doNossoApp: eco && String(m.app_id || '') === APP_ID,
      texto: textoDM(m), tipo: m.attachments && m.attachments.length && !m.text ? m.attachments[0].type : 'text',
      ...midiaDM(m),
      em: new Date((t => t && t < 1e12 ? t * 1000 : t || Date.now())(Number(ev.timestamp))).toISOString()
    });
  }
  return out;
}

// ------------------------------- Rede ---------------------------------------
let _pag = null, _quando = 0;
async function pagina() {
  if (_pag && Date.now() - _quando < 30 * 60 * 1000) return _pag;
  const tk = process.env.META_TOKEN;
  if (!tk) throw new Error('META_TOKEN ausente');
  const r = await fetch(`${G}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=50&access_token=${encodeURIComponent(tk)}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`Meta: ${(j.error && j.error.message) || r.status}`);
  const pags = j.data || [];
  const p = process.env.META_PAGE_ID ? pags.find(x => x.id === process.env.META_PAGE_ID) : (pags.find(x => /condux/i.test(x.name)) || pags[0]);
  if (!p) throw new Error('Nenhuma Página visível para o token.');
  _pag = { pageId: p.id, pageToken: p.access_token, igId: p.instagram_business_account && p.instagram_business_account.id };
  _quando = Date.now();
  return _pag;
}

async function enviarDM(wa_id, texto) {
  const p = await pagina();
  const r = await fetch(`${G}/${p.pageId}/messages?access_token=${encodeURIComponent(p.pageToken)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: idDestino(wa_id) }, messaging_type: 'RESPONSE', message: { text: texto } })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`${NOME_CANAL[canalDe(wa_id)]}: ${(j.error && (j.error.error_user_msg || j.error.message)) || r.status}`);
  return { id: j.message_id || `out_${Date.now()}` };
}

// "Digitando…" (só Messenger aceita; no Instagram é ignorado sem erro)
async function digitando(wa_id) {
  try {
    const p = await pagina();
    await fetch(`${G}/${p.pageId}/messages?access_token=${encodeURIComponent(p.pageToken)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: idDestino(wa_id) }, sender_action: 'typing_on' })
    });
  } catch (e) {}
}

// Nome/usuário do cliente (melhor esforço)
async function perfil(wa_id) {
  try {
    const p = await pagina();
    const campos = canalDe(wa_id) === 'instagram' ? 'name,username' : 'first_name,last_name,name';
    const r = await fetch(`${G}/${idDestino(wa_id)}?fields=${campos}&access_token=${encodeURIComponent(p.pageToken)}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) return {};
    return { nome: j.name || [j.first_name, j.last_name].filter(Boolean).join(' ') || null, usuario: j.username || null };
  } catch (e) { return {}; }
}

function resumoWebhook(body) {
  const e = body.entry || [];
  return `object=${body.object} entries=${e.length} messaging=${e.reduce((n, x) => n + (x.messaging || []).length, 0)} changes=${e.flatMap(x => (x.changes || []).map(c => c.field)).join(',') || '-'}`;
}

module.exports = { resumoWebhook, canalDe, ehDM, idDestino, NOME_CANAL, textoDM, eventosDM, pagina, enviarDM, digitando, perfil };
