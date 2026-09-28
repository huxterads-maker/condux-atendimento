// Netlify Function: nuvem-app.js — app oficial "Condux IA" na Nuvemshop.
// Só para quem está logado no painel (guarda). Ações:
//   GET  ?acao=status               → app configurado? loja conectada? catálogo?
//   POST {acao:'conectar', code}    → troca o código do OAuth pelo token da loja
//   POST {acao:'sincronizar'}       → dispara a sincronização do catálogo
//   GET  ?acao=pedido&numero=1234   → teste: situação de um pedido do site
// Variáveis no Netlify: NUVEM_APP_ID (ID do app) e NUVEM_CLIENT_SECRET (segredo).
const N = require('../lib/nuvem');
const { proteger, cabecalhoInterno } = require('../lib/guarda');
const { usuarioDoPainel } = require('../lib/painel-auth');
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const SBH = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' };
const sb = async (p, o = {}) => { const r = await fetch(`${SB_URL}/rest/v1/${p}`, { ...o, headers: { ...SBH, ...(o.headers || {}) } }); const t = await r.text(); if (!r.ok) throw new Error(`Supabase ${r.status}: ${t.slice(0, 200)}`); return t ? JSON.parse(t) : null; };
const SITE = process.env.URL || 'https://condux-atendimento.netlify.app';
const json = (statusCode, obj) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) });

const handler = async (event) => {
  const q = event.queryStringParameters || {};
  let corpo = {}; try { corpo = JSON.parse(event.body || '{}'); } catch (e) {}
  const acao = corpo.acao || q.acao || 'status';
  const appId = process.env.NUVEM_APP_ID;
  try {
    if (acao === 'status') {
      const tk = (await sb('nuvem_tokens?id=eq.1&select=store_id,scope,conectado_por,atualizado_em'))[0] || null;
      const cat = await sb('catalogo?fonte=eq.api&ativo=eq.true&select=disponivel').catch(() => []);
      const logs = await sb(`wa_log?msg=like.${encodeURIComponent('[catálogo]*')}&select=msg,nivel,em&order=em.desc&limit=3`).catch(() => []);
      return json(200, {
        app_id: appId, segredo_configurado: !!process.env.NUVEM_CLIENT_SECRET,
        redirect: `${SITE}/nuvem-callback.html`, conexao: tk,
        catalogo: { produtos: cat.length, com_estoque: cat.filter(c => c.disponivel).length }, logs
      });
    }
    if (acao === 'conectar') {
      if (!appId || !process.env.NUVEM_CLIENT_SECRET) return json(400, { erro: 'Faltam NUVEM_APP_ID e/ou NUVEM_CLIENT_SECRET no Netlify.' });
      if (!corpo.code) return json(400, { erro: 'Código de autorização ausente.' });
      const r = await fetch('https://www.tiendanube.com/apps/authorize/token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: appId, client_secret: process.env.NUVEM_CLIENT_SECRET, grant_type: 'authorization_code', code: corpo.code })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.access_token || !j.user_id) return json(400, { erro: `Nuvemshop recusou o código: ${j.error_description || j.error || r.status}. O código vale 5 minutos — clique em Conectar de novo.` });
      const u = await usuarioDoPainel(event);
      await sb('nuvem_tokens?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: 1, store_id: String(j.user_id), access_token: j.access_token, scope: j.scope || null, conectado_por: (u && u.email) || null, atualizado_em: new Date().toISOString() }) });
      await fetch(`${SITE}/.netlify/functions/nuvem-catalogo-background`, { headers: cabecalhoInterno() }).catch(() => {});
      return json(200, { ok: true, store_id: String(j.user_id), scope: j.scope });
    }
    if (acao === 'sincronizar') {
      await fetch(`${SITE}/.netlify/functions/nuvem-catalogo-background`, { headers: cabecalhoInterno() });
      return json(200, { ok: true });
    }
    if (acao === 'pedido') {
      const o = await N.buscarPedido(sb, String(q.numero || corpo.numero || '').replace(/\D/g, ''));
      if (!o) return json(404, { erro: 'Pedido não encontrado na Nuvemshop.' });
      const envioBruto = {};
      for (const [k, v] of Object.entries(o)) if (/shipping|deliver|fulfill/i.test(k) && k !== 'shipping_address') envioBruto[k] = v;
      if (q.bruto === '2') {
        const tk = await N.tokenLoja(sb);
        const fo = await N.api(tk, `/orders/${o.id}/fulfillment-orders`).catch(e => ({ erro: e.message }));
        const v1 = await fetch(`https://api.nuvemshop.com.br/v1/${tk.store_id}/orders/${o.id}?fields=shipping_min_days,shipping_max_days,shipping_option,shipping_estimated_delivery_date,shipped_at`, { headers: { Authentication: `bearer ${tk.access_token}`, 'User-Agent': require('../lib/marca').MARCA.user_agent } }).then(r => r.json()).catch(e => ({ erro: e.message }));
        const tira = x => JSON.parse(JSON.stringify(x, (k, v) => (/name|email|phone|address|document|street|zipcode|recipient/i.test(k) && typeof v === 'string') ? '[omitido]' : v));
        return json(200, { fulfillment_orders: tira(fo), v1: tira(v1) });
      }
      return json(200, { pedido: N.resumoPedido(o, () => true), telefones_no_pedido: N.telefonesDoPedido(o).length, ...(q.bruto ? { envio_bruto: envioBruto } : {}) });
    }
    // Teste: o cliente já comprou no site? (não mostra dados pessoais)
    if (acao === 'cliente') {
      const C = require('../lib/carrinho'); const W = require('../lib/wa-nucleo');
      let telefone = q.telefone || corpo.telefone;
      if (corpo.autoteste_telefone) {   // pega o telefone de um cliente que já comprou (não é exibido)
        const tk = await N.tokenLoja(sb); const cs = (await N.api(tk, '/customers?per_page=50')) || [];
        const c = cs.find(x => Number(x.total_spent) > 0 && (x.phone || (x.default_address && x.default_address.phone)));
        if (!c) return json(200, { erro: 'nenhum cliente com telefone na amostra' });
        telefone = c.phone || c.default_address.phone;
      }
      const res = await C.identificarCliente(N, sb, { telefone, emails: W.extrairEmails(q.email || corpo.email || ''), mesmoTelefone: W.mesmoTelefone });
      return json(200, res);
    }
    if (acao === 'cupons') {
      const tk = await N.tokenLoja(sb);
      const lista = await N.todasPaginas(tk, '/coupons', 5);
      return json(200, { cupons: lista.map(c => ({ codigo: c.code, tipo: c.type, valor: c.value, valido: c.valid, usados: c.used, max_usos: c.max_uses, inicio: c.start_date, fim: c.end_date, minimo: c.min_price, primeira_compra: c.first_consumer_purchase, combina_promocoes: c.combines_with_other_discounts })) });
    }
    return json(400, { erro: 'Ação desconhecida.' });
  } catch (e) { return json(500, { erro: e.message }); }
};
exports.handler = proteger(handler);
