// Netlify Scheduled Function: atualiza o catálogo pela API da Nuvemshop a cada 2 horas.
const SITE = process.env.URL || 'https://condux-atendimento.netlify.app';
exports.handler = async () => {
  try { await fetch(`${SITE}/.netlify/functions/nuvem-catalogo-background`, { headers: require('../lib/guarda').cabecalhoInterno() }); } catch (e) {}
  return { statusCode: 200 };
};
