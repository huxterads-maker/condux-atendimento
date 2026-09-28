// Netlify Scheduled Function: meta-comentarios-rapido.js
// Roda A CADA MINUTO (netlify.toml). Dispara uma rodada LEVE da background
// (?rapido=1): só anúncios ativos + posts dos últimos 3 dias, no máx. 15
// respostas. Assim um comentário novo é respondido em ~1-2 min.
// Nos minutos múltiplos de 10 não dispara: a rodada completa
// (meta-comentarios-scheduled) roda nesses minutos e precisa da trava livre.

const SITE = process.env.URL || 'https://condux-atendimento.netlify.app';

exports.handler = async () => {
  if (new Date().getUTCMinutes() % 10 === 0) return { statusCode: 200, body: JSON.stringify({ ok: true, pulado: 'minuto da rodada completa' }) };
  const url = `${SITE}/.netlify/functions/meta-comentarios-background?rapido=1`;
  try { await fetch(url, { headers: require('../lib/guarda').cabecalhoInterno() }).catch(() => {}); } catch (e) {}
  return { statusCode: 200, body: JSON.stringify({ ok: true, disparado: 'meta-comentarios-background?rapido=1' }) };
};
