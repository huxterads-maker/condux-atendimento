// Netlify Scheduled Function: meta-comentarios-scheduled.js
// Roda A CADA 10 MIN (netlify.toml). Disparador leve: aciona a função de fundo
// que lê os comentários dos anúncios ativos e dos posts recentes (Instagram e
// Facebook), classifica com IA e responde. Todo o trabalho e o log ficam na
// background (meta_log / meta_config.ultimo_resumo).

const SITE = process.env.URL || 'https://condux-atendimento.netlify.app';

exports.handler = async () => {
  const url = `${SITE}/.netlify/functions/meta-comentarios-background`;
  try { await fetch(url, { headers: require('../lib/guarda').cabecalhoInterno() }).catch(() => {}); } catch (e) {}
  return { statusCode: 200, body: JSON.stringify({ ok: true, disparado: 'meta-comentarios-background' }) };
};
