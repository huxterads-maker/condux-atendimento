// Netlify Function: wa-midia.js — abre no painel a foto/áudio/vídeo de uma mensagem.
// GET ?id=<id da mensagem>  (só painel logado)
const { baixarMidia } = require('../lib/midia');
const { proteger } = require('../lib/guarda');
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

const handler = async (event) => {
  const id = (event.queryStringParameters || {}).id;
  if (!id) return { statusCode: 400, body: 'id obrigatório' };
  try {
    const r = await fetch(`${SB_URL}/rest/v1/wa_mensagens?id=eq.${encodeURIComponent(id)}&select=midia_id,midia_url,midia_mime`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
    const m = (await r.json())[0];
    if (!m) return { statusCode: 404, body: 'mensagem não encontrada' };
    const { buf, mime } = await baixarMidia(m);
    return { statusCode: 200, headers: { 'Content-Type': mime, 'Cache-Control': 'private, max-age=3600' }, body: buf.toString('base64'), isBase64Encoded: true };
  } catch (e) {
    return { statusCode: e.grande ? 413 : 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: e.message };
  }
};
exports.handler = proteger(handler);
