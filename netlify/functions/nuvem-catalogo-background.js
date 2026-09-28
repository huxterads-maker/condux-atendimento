// Netlify Background Function: nuvem-catalogo-background.js
// Sincroniza o catálogo pela API oficial da Nuvemshop (app "Condux IA"):
// produtos, categorias, marca, preço/promoção, variações com estoque,
// descrição (com tabela de medidas) e link. Grava na tabela catalogo, que a IA
// do WhatsApp e dos comentários consulta. Disparada a cada 2 h
// (nuvem-catalogo-scheduled) ou pelo painel (nuvem.html).
const N = require('../lib/nuvem');
const C = require('../lib/carrinho');
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const SBH = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' };
const sb = async (p, o = {}) => { const r = await fetch(`${SB_URL}/rest/v1/${p}`, { ...o, headers: { ...SBH, ...(o.headers || {}) } }); const t = await r.text(); if (!r.ok) throw new Error(`Supabase ${r.status}: ${t.slice(0, 200)}`); return t ? JSON.parse(t) : null; };
const log = (msg, nivel = 'info') => sb('wa_log', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ msg: `[catálogo] ${msg}`.slice(0, 2000), nivel }) }).catch(() => {});

const handler = async () => {
  const t0 = Date.now(); const inicio = new Date().toISOString();
  try {
    const tk = await N.tokenLoja(sb);
    const cats = N.mapaCategorias(await N.todasPaginas(tk, '/categories', 10));
    const crus = await N.todasPaginas(tk, '/products');
    const prods = crus.map(p => N.produtoParaCatalogo(p, cats)).filter(p => p.url && p.nome);
    // Remove duplicados de URL (mantém o primeiro)
    const vistos = new Set(); const unicos = prods.filter(p => !vistos.has(p.url) && vistos.add(p.url));
    for (let k = 0; k < unicos.length; k += 100) {
      await sb('catalogo?on_conflict=url', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(unicos.slice(k, k + 100)) });
    }
    // O que não veio da API nesta rodada (produto apagado ou linha antiga do site) fica inativo
    if (unicos.length >= 10) {
      await sb(`catalogo?atualizado_em=lt.${encodeURIComponent(inicio)}&ativo=eq.true`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ativo: false }) });
    }
    const ativos = unicos.filter(p => p.ativo).length;
    await log(`${unicos.length} produtos lidos da Nuvemshop (${ativos} publicados, ${unicos.filter(p => p.ativo && p.disponivel).length} com estoque) em ${Math.round((Date.now() - t0) / 1000)}s.`);
  } catch (e) { await log(`falhou: ${e.message}`, 'erro'); }
  // Clientes (1x por dia): hash do telefone + se já comprou — para a IA saber se é
  // cliente antigo no WhatsApp e oferecer o cupom certo. Sem telefone legível.
  try {
    const ult = await sb('nuvem_clientes_tel?select=atualizado_em&order=atualizado_em.desc&limit=1').catch(() => []);
    if (!ult[0] || Date.now() - new Date(ult[0].atualizado_em).getTime() > 20 * 3600 * 1000) {
      const t1 = Date.now(); const tk = await N.tokenLoja(sb);
      const cs = await N.todasPaginas(tk, '/customers', 100);
      const linhas = {}; const agora = new Date().toISOString();
      for (const c of cs) {
        const comprou = Number(c.total_spent) > 0 || !!c.last_order_id;
        for (const t of [c.phone, c.billing_phone, c.default_address && c.default_address.phone]) {
          const h = C.hashTel(t); if (h) linhas[h] = { hash: h, comprou: comprou || !!(linhas[h] && linhas[h].comprou), atualizado_em: agora };
        }
      }
      // Pedidos pagos (inclui quem comprou sem criar conta)
      const peds = await N.todasPaginas(tk, '/orders?payment_status=paid&fields=id,contact_phone,billing_phone,shipping_address,customer', 100).catch(() => []);
      for (const o of peds) for (const t of N.telefonesDoPedido(o)) { const h = C.hashTel(t); if (h) linhas[h] = { hash: h, comprou: true, atualizado_em: agora }; }
      const lista = Object.values(linhas);
      for (let k = 0; k < lista.length; k += 500) await sb('nuvem_clientes_tel?on_conflict=hash', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(lista.slice(k, k + 500)) });
      await log(`${cs.length} clientes e ${peds.length} pedidos pagos lidos (${lista.filter(l => l.comprou).length} telefones de quem já comprou) em ${Math.round((Date.now() - t1) / 1000)}s.`);
    }
  } catch (e) { await log(`clientes falhou: ${e.message}`, 'erro'); }
  return { statusCode: 200 };
};
exports.handler = require('../lib/guarda').proteger(handler);
