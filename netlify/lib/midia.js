// Download de mídia recebida (foto, áudio, vídeo, documento).
// WhatsApp: o webhook traz só o ID; a URL (temporária) sai da Graph API e o
// download exige o token. Direct/Messenger: URL direta do CDN da Meta.
const GV = process.env.META_API_VERSION || 'v23.0';
const LIMITE = 5.5 * 1024 * 1024; // resposta de função do Netlify ~6 MB

async function baixarMidia(msg) {
  let url = msg.midia_url, headers = {}, mime = msg.midia_mime || null;
  if (msg.midia_id) {
    const tk = process.env.WA_TOKEN || process.env.META_TOKEN;
    const r = await fetch(`https://graph.facebook.com/${GV}/${msg.midia_id}`, { headers: { Authorization: `Bearer ${tk}` } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.url) throw new Error((j.error && j.error.message) || 'mídia indisponível (o WhatsApp guarda por 30 dias)');
    url = j.url; mime = j.mime_type || mime; headers = { Authorization: `Bearer ${tk}` };
  }
  if (!url) throw new Error('mensagem sem mídia');
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`download ${r.status} (link da mídia expirou?)`);
  const len = +r.headers.get('content-length') || 0;
  if (len > LIMITE) { const e = new Error('arquivo grande demais para abrir no painel'); e.grande = true; throw e; }
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > LIMITE) { const e = new Error('arquivo grande demais para abrir no painel'); e.grande = true; throw e; }
  return { buf, mime: (mime || r.headers.get('content-type') || 'application/octet-stream').split(';')[0] };
}
module.exports = { baixarMidia, LIMITE };
