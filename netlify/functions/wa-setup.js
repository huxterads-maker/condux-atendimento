// Netlify Function: wa-setup.js — configuração do número do WhatsApp (só painel logado).
//   GET                                   → contas do WhatsApp (WABA) da empresa e números,
//                                           número configurado hoje e inscrição do webhook
//   POST {acao:'usar', waba_id, phone_number_id}
//        → registra o número na API (Cloud API, com PIN de 2 etapas), inscreve o app na
//          conta para os webhooks chegarem e grava em wa_config. Não exibe tokens.
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const GV = process.env.META_API_VERSION || 'v23.0';
const G = `https://graph.facebook.com/${GV}`;
const BM = process.env.META_BUSINESS_ID;
const crypto = require('crypto');
const json = (c, b) => ({ statusCode: c, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(b, null, 2) });
const sbH = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' };

const handler = async (event) => {
  const tk = process.env.WA_TOKEN || process.env.META_TOKEN;
  if (!tk || !BM) return json(400, { erro: 'Configure no Netlify: META_TOKEN (ou WA_TOKEN) e META_BUSINESS_ID (ID do Business Manager da Condux).' });
  const g = async (path, opt = {}) => { const r = await fetch(`${G}/${path}`, { ...opt, headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json', ...(opt.headers || {}) } }); return r.json().catch(() => ({})); };
  const cfg = (await (await fetch(`${SB_URL}/rest/v1/wa_config?id=eq.1&select=*`, { headers: sbH })).json())[0] || {};
  let corpo = {}; try { corpo = JSON.parse(event.body || '{}'); } catch (e) {}
  try {
    if (event.httpMethod === 'POST' && corpo.acao === 'usar') {
      const { waba_id, phone_number_id } = corpo;
      if (!/^\d+$/.test(waba_id || '') || !/^\d+$/.test(phone_number_id || '')) return json(400, { erro: 'waba_id e phone_number_id obrigatórios' });
      // PIN de verificação em 2 etapas do número (guardado no banco, só a equipe vê)
      const pin = cfg.pin_2fa && cfg.phone_number_id === phone_number_id ? cfg.pin_2fa : String(crypto.randomInt(100000, 999999));
      const reg = await g(`${phone_number_id}/register`, { method: 'POST', body: JSON.stringify({ messaging_product: 'whatsapp', pin }) });
      const sub = await g(`${waba_id}/subscribed_apps`, { method: 'POST' });
      const num = await g(`${phone_number_id}?fields=display_phone_number,verified_name,name_status,quality_rating,platform_type,status,code_verification_status`);
      if (reg.success || (reg.error && /already registered/i.test(reg.error.message || ''))) {
        await fetch(`${SB_URL}/rest/v1/wa_config?id=eq.1`, { method: 'PATCH', headers: { ...sbH, Prefer: 'return=minimal' }, body: JSON.stringify({ waba_id, phone_number_id, numero_exibicao: num.display_phone_number || null, pin_2fa: pin, atualizado_em: new Date().toISOString() }) });
      }
      return json(200, { registro: reg, inscricao_webhook: sub, numero: num });
    }
    // Teste: envia o modelo padrão hello_world para um número (abre a conversa no celular)
    if (event.httpMethod === 'POST' && corpo.acao === 'teste' && /^\d{12,13}$/.test(corpo.para || '')) {
      const r = await g(`${cfg.phone_number_id}/messages`, { method: 'POST', body: JSON.stringify({ messaging_product: 'whatsapp', to: corpo.para, type: 'template', template: { name: 'hello_world', language: { code: 'en_US' } } }) });
      return json(200, r);
    }
    // Verificação do número por código (SMS ou ligação) — antes do registro
    if (event.httpMethod === 'POST' && corpo.acao === 'pedir_codigo' && /^\d+$/.test(corpo.phone_number_id || '')) {
      const metodo = corpo.metodo === 'VOICE' ? 'VOICE' : 'SMS';
      return json(200, await g(`${corpo.phone_number_id}/request_code`, { method: 'POST', body: JSON.stringify({ code_method: metodo, language: 'pt_BR' }) }));
    }
    if (event.httpMethod === 'POST' && corpo.acao === 'verificar_codigo' && /^\d+$/.test(corpo.phone_number_id || '') && /^\d{6}$/.test(corpo.codigo || '')) {
      return json(200, await g(`${corpo.phone_number_id}/verify_code`, { method: 'POST', body: JSON.stringify({ code: corpo.codigo }) }));
    }
    const out = { configurado: { waba_id: cfg.waba_id, phone_number_id: cfg.phone_number_id, numero: cfg.numero_exibicao, modo: cfg.modo }, app_secret_configurado: !!process.env.META_APP_SECRET, contas: [], erros: [] };
    const own = await g(`${BM}/owned_whatsapp_business_accounts?fields=id,name,account_review_status`);
    const cli = await g(`${BM}/client_whatsapp_business_accounts?fields=id,name,account_review_status`);
    for (const r of [own, cli]) if (r.error) out.erros.push(r.error.message);
    const wabas = [...(own.data || []), ...(cli.data || [])];
    // WABA informada à mão (quando o token não lista as contas do portfólio)
    if (/^\d+$/.test(event.queryStringParameters?.waba || '') && !wabas.some(w => w.id === event.queryStringParameters.waba)) {
      const w = await g(`${event.queryStringParameters.waba}?fields=id,name,account_review_status`);
      if (w.error) out.erros.push(w.error.message); else wabas.push(w);
    }
    for (const w of wabas) {
      const nums = (await g(`${w.id}/phone_numbers?fields=id,display_phone_number,verified_name,name_status,status,platform_type,code_verification_status,quality_rating`)).data || [];
      const inscritos = (await g(`${w.id}/subscribed_apps`)).data || [];
      out.contas.push({ waba_id: w.id, nome: w.name, revisao: w.account_review_status, app_inscrito: inscritos.map(a => (a.whatsapp_business_api_data || {}).name || a.name || a.id), numeros: nums });
    }
    return json(200, out);
  } catch (e) { return json(500, { erro: e.message }); }
};
exports.handler = require('../lib/guarda').proteger(handler);
