// Guarda das funções: só deixa passar
//  (a) chamadas internas entre funções (cabeçalho x-interno, derivado da
//      SUPABASE_SERVICE_KEY — nunca sai do servidor), ou
//  (b) quem está logado no painel e autorizado (x-painel-token, via auth.js).
const crypto = require('crypto');
const { usuarioDoPainel } = require('./painel-auth');

function chaveInterna() {
  const k = process.env.SUPABASE_SERVICE_KEY;
  return k ? crypto.createHmac('sha256', k).update('condux-interno-v1').digest('hex') : null;
}
function cabecalhoInterno(extra) { const c = chaveInterna(); return Object.assign(c ? { 'x-interno': c } : {}, extra || {}); }
async function autorizado(event) {
  const h = (event && event.headers) || {};
  const c = chaveInterna();
  const recebido = h['x-interno'] || h['X-Interno'];
  if (c && recebido && recebido.length === c.length && crypto.timingSafeEqual(Buffer.from(recebido), Buffer.from(c))) return { interno: true };
  return usuarioDoPainel(event);
}
function negado() {
  return { statusCode: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ erro: 'Acesso negado: faça login no painel.' }) };
}
// Envolve um handler existente
function proteger(handler) {
  return async (event, context) => {
    if (event && event.httpMethod === 'OPTIONS') return handler(event, context);
    if (!(await autorizado(event))) return negado();
    return handler(event, context);
  };
}
module.exports = { chaveInterna, cabecalhoInterno, autorizado, negado, proteger };
