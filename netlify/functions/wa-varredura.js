// Netlify Scheduled Function: wa-varredura.js (a cada 2 min)
// Rede de segurança: se algum disparo do webhook se perdeu, encontra conversas
// com mensagem do cliente ainda sem resposta (há mais de 1 min) e aciona a IA.
const SITE = process.env.URL || 'https://condux-atendimento.netlify.app';
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async () => {
  try {
    const h = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };
    const ate = new Date(Date.now() - 60 * 1000).toISOString();
    const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();   // só dentro da janela de 24h
    const r = await fetch(`${SB_URL}/rest/v1/wa_mensagens?select=wa_id&direcao=eq.in&status=eq.recebida&criado_em=lt.${ate}&criado_em=gt.${desde}&limit=200`, { headers: h });
    const ids = [...new Set(((await r.json()) || []).map(x => x.wa_id))].slice(0, 20);
    for (const wa_id of ids) await fetch(`${SITE}/.netlify/functions/wa-responder-background?wa_id=${encodeURIComponent(wa_id)}`, { headers: require('../lib/guarda').cabecalhoInterno() }).catch(() => {});
    // Retenção (política publicada): apaga atendimentos sem interação há mais de 12 meses, 1x por hora
    if (new Date().getUTCMinutes() < 2) {
      const limite = new Date(Date.now() - 365 * 864e5).toISOString();
      await fetch(`${SB_URL}/rest/v1/wa_conversas?ultima_msg_em=lt.${limite}`, { method: 'DELETE', headers: { ...h, Prefer: 'return=minimal' } }).catch(() => {});
      await fetch(`${SB_URL}/rest/v1/meta_comentarios?criado_em=lt.${limite}`, { method: 'DELETE', headers: { ...h, Prefer: 'return=minimal' } }).catch(() => {});
    }
    return { statusCode: 200, body: JSON.stringify({ disparados: ids.length }) };
  } catch (e) { return { statusCode: 200, body: JSON.stringify({ erro: e.message }) }; }
};
