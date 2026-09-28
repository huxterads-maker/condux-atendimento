// Netlify Function: nuvem-lgpd.js — webhooks obrigatórios de LGPD do app Nuvemshop.
//   ?tipo=store-redact            → loja desinstalou: apaga o token da loja
//   ?tipo=customers-redact        → cliente pediu exclusão: não guardamos cadastro
//                                    de clientes da Nuvemshop (só consultamos na hora)
//   ?tipo=customers-data-request  → pedido de dados: idem, só registra
// Assinatura conferida com NUVEM_CLIENT_SECRET (cabeçalho x-linkedstore-hmac-sha256).
const crypto = require('crypto');
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const SBH = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
const log = msg => fetch(`${SB_URL}/rest/v1/wa_log`, { method: 'POST', headers: SBH, body: JSON.stringify({ msg: `[nuvem-lgpd] ${msg}`.slice(0, 2000), nivel: 'info' }) }).catch(() => {});

function assinaturaOk(event) {
  const seg = process.env.NUVEM_CLIENT_SECRET; if (!seg) return false;
  const h = event.headers || {};
  const rec = h['x-linkedstore-hmac-sha256'] || h['http_x_linkedstore_hmac_sha256'] || '';
  const corpo = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : Buffer.from(event.body || '');
  const calc = crypto.createHmac('sha256', seg).update(corpo).digest('hex');
  return rec.length === calc.length && crypto.timingSafeEqual(Buffer.from(rec), Buffer.from(calc));
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 200, body: 'ok' };
  if (!assinaturaOk(event)) return { statusCode: 401, body: 'assinatura inválida' };
  const tipo = (event.queryStringParameters || {}).tipo || '';
  let d = {}; try { d = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body); } catch (e) {}
  if (tipo === 'store-redact') {
    await fetch(`${SB_URL}/rest/v1/nuvem_tokens?store_id=eq.${encodeURIComponent(String(d.store_id || ''))}`, { method: 'DELETE', headers: SBH }).catch(() => {});
    await log(`loja ${d.store_id} removeu o app: token apagado.`);
  } else {
    await log(`${tipo} recebido (loja ${d.store_id}, cliente ${d.customer && d.customer.id}): nenhum cadastro de cliente da Nuvemshop é armazenado.`);
  }
  return { statusCode: 200, body: 'ok' };
};
