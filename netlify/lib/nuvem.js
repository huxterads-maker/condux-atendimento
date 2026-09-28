// Integração oficial com a Nuvemshop (app "Condux IA", API REST).
// - Token da loja fica na tabela nuvem_tokens (só a chave de serviço lê).
// - Conversão de produto → linha da tabela catalogo (mesmo formato usado pela IA).
// - Consulta de pedido por número com conferência do telefone do WhatsApp.
// As funções de conversão não usam rede (testáveis).
const { MARCA } = require('./marca');
const LOJA = MARCA.loja;
const VERSAO = process.env.NUVEM_API_VERSAO || '2025-03';
const UA = require('../lib/marca').MARCA.user_agent;

const pt = v => (v && typeof v === 'object') ? (v.pt || v.es || v.en || Object.values(v)[0] || '') : (v || '');
const num = v => (v === null || v === undefined || v === '') ? null : +v;
const decodeHtml = s => String(s || '').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
const texto = html => decodeHtml(String(html || '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|h\d|tr|div)>/gi, '\n').replace(/<\/t[dh]>/gi, ' | ').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

// ------------------------------ Catálogo ------------------------------------
// categorias: lista crua de GET /categories → caminho "Pai > Filho"
function mapaCategorias(categorias) {
  const porId = {}; for (const c of categorias || []) porId[c.id] = c;
  const caminho = (c, n = 0) => { if (!c || n > 5) return ''; const pai = c.parent && porId[c.parent]; const nome = String(pt(c.name)).replace(/\s+/g, ' ').trim(); return pai ? `${caminho(pai, n + 1)} > ${nome}` : nome; };
  const out = {}; for (const c of categorias || []) out[c.id] = caminho(c);
  return out;
}

function produtoParaCatalogo(p, cats = {}) {
  const handle = pt(p.handle);
  const url = (p.canonical_url || (handle ? `${LOJA}/produtos/${handle}/` : '')).replace(/^http:/, 'https:');
  // Categoria mais específica (caminho mais longo)
  // Categoria principal: a mais específica (ex.: Cabos por bitola > 2,5 mm), não a
  // de marca nem a de campanha; as demais viram tags.
  const nomesCat = [...new Set((p.categories || []).map(c => cats[c.id] || String(pt(c.name)).replace(/\s+/g, ' ').trim()).filter(Boolean))];
  const peso = n => (n.includes('>') ? 2 : 0) + (/^marcas?\b/i.test(n) ? -3 : 0) + n.split('>').length * 0.1;
  const principal = [...nomesCat].sort((a, b) => peso(b) - peso(a))[0] || null;
  const vs = (p.variants || []).map(v => {
    const cheio = num(v.price), promo = num(v.promotional_price);
    const temPromo = promo != null && cheio != null && promo > 0 && promo < cheio;
    const estoque = v.stock_management === false || v.stock == null ? null : +v.stock;
    return {
      id: v.id,  // código da variação (para o link de carrinho /comprar/{id}-{qtd}/)
      opcoes: (v.values || []).map(pt).filter(Boolean),
      estoque, disponivel: estoque == null || estoque > 0,
      preco: temPromo ? promo : cheio, preco_de: temPromo ? cheio : null
    };
  });
  const precos = vs.map(v => v.preco).filter(x => x != null);
  const tags = [...new Set([...String(p.tags || '').split(','), ...nomesCat.filter(n => n !== principal)].map(t => t.trim().toLowerCase()).filter(Boolean))];
  return {
    url, produto_id: p.id, nome: pt(p.name).trim(), categoria: principal, marca: p.brand || null, tags,
    preco: precos.length ? Math.min(...precos) : null,
    preco_de: (vs.find(v => v.preco_de) || {}).preco_de || null,
    disponivel: p.published !== false && vs.some(v => v.disponivel),
    estoque_total: vs.reduce((s, v) => s + (v.estoque || 0), 0),
    variantes: vs, descricao: texto(pt(p.description)).slice(0, 1800),
    imagem: (p.images && p.images[0] && p.images[0].src) || null,
    ativo: p.published !== false, fonte: 'api', atualizado_em: new Date().toISOString()
  };
}

// ------------------------------- Pedidos ------------------------------------
const STATUS = { open: 'em andamento', closed: 'concluído', cancelled: 'cancelado' };
const PAGTO = { authorized: 'autorizado (aguardando confirmação)', pending: 'aguardando pagamento', paid: 'pago', partially_paid: 'parcialmente pago', abandoned: 'não concluído', refunded: 'reembolsado', partially_refunded: 'parcialmente reembolsado', voided: 'cancelado' };
const ENVIO = { unpacked: 'em separação', unshipped: 'ainda não enviado', partially_packed: 'parcialmente embalado', partially_fulfilled: 'parcialmente enviado', shipped: 'enviado', delivered: 'entregue' };

function telefonesDoPedido(o) {
  return [o.contact_phone, o.billing_phone, o.customer && o.customer.phone, o.shipping_address && o.shipping_address.phone,
    o.customer && o.customer.default_address && o.customer.default_address.phone].filter(Boolean);
}

// o = pedido cru da API; confere(tel) → bool (mesmo telefone do WhatsApp)
// confereEmail(e) → bool (e-mail da compra informado pelo cliente na conversa)
function resumoPedido(o, confere, confereEmail = () => false) {
  if (!o) return null;
  const ok = telefonesDoPedido(o).some(t => confere(t)) || [o.contact_email, o.customer && o.customer.email].some(e => e && confereEmail(e));
  if (!ok) return { estado: 'NAO_VERIFICADO', numero: String(o.number) };
  const fos = [...(o.fulfillments || []), ...(o.fulfillment_orders || [])];
  const ful = fos.map(f => f.tracking_info || {}).filter(t => t.code || t.url);
  const envs = fos.map(f => f.shipping || {});
  const env = Object.assign({}, envs.find(x => x.option || x.carrier) || {}, envs.find(x => x.max_delivery_date || x.min_delivery_date) || {});
  const nomeOpc = x => x && (typeof x === 'object' ? (pt(x.name) || x.code) : x);
  const dia = d => { const t = String(d || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t.split('-').reverse().join('/') : null; };
  // Prazo: datas previstas do envio; senão, dias mínimos/máximos contados da compra
  let prazo = null;
  if (env.min_delivery_date || env.max_delivery_date) prazo = [...new Set([dia(env.min_delivery_date), dia(env.max_delivery_date)].filter(Boolean))].join(' a ');
  else if (o.shipping_max_days) prazo = `${o.shipping_min_days && o.shipping_min_days !== o.shipping_max_days ? o.shipping_min_days + ' a ' : ''}${o.shipping_max_days} dias úteis (contados da confirmação do pagamento)`;
  const end = o.shipping_address || {};
  const codigos = [...new Set([o.shipping_tracking_number, ...ful.map(t => t.code)].filter(Boolean))];
  const links = [...new Set([o.shipping_tracking_url, ...ful.map(t => t.url)].filter(Boolean))];
  return {
    estado: 'VERIFICADO', origem: 'site', numero: String(o.number),
    data: (o.created_at || '').slice(0, 10),
    situacao: STATUS[o.status] || o.status,
    pagamento: PAGTO[o.payment_status] || o.payment_status,
    envio: ENVIO[o.shipping_status] || o.shipping_status,
    forma_envio: [nomeOpc(env.carrier), nomeOpc(env.option) || nomeOpc(o.shipping_option) || o.shipping_carrier_name].filter(Boolean).join(' — ') || null,
    prazo_entrega: prazo, retirada: o.shipping_pickup_type === 'pickup' || undefined,
    destino: [end.city, end.province].filter(Boolean).join('/') + (end.zipcode ? ` (CEP ${end.zipcode})` : '') || null,
    enviado_em: (o.shipped_at || '').slice(0, 10) || null,
    rastreio: codigos.join(', '), link_rastreio: links[0] || null,
    itens: (o.products || []).map(i => `${i.quantity}x ${pt(i.name)}`).join('; ').slice(0, 400)
  };
}

// ------------------------------- Rede ---------------------------------------
async function tokenLoja(sb) {
  const r = (await sb('nuvem_tokens?id=eq.1&select=store_id,access_token'))[0];
  if (!r) throw new Error('Nuvemshop não conectada (abra o painel e clique em Conectar Nuvemshop)');
  return r;
}
async function api(tk, caminho) {
  const url = `https://api.nuvemshop.com.br/${VERSAO}/${tk.store_id}${caminho}`;
  for (let i = 0; i < 5; i++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${tk.access_token}`, Authentication: `bearer ${tk.access_token}`, 'User-Agent': UA, Accept: 'application/json' } }).catch(() => null);
    if (r && r.ok) return r.json();
    if (r && r.status === 404) return null;          // lista vazia / não achou
    if (r && (r.status === 401 || r.status === 403)) throw new Error(`Nuvemshop ${r.status}: token sem acesso — reconecte o app no painel`);
    await new Promise(s => setTimeout(s, r && r.status === 429 ? 3000 : 1200 * (i + 1)));
  }
  throw new Error(`Nuvemshop indisponível (${caminho.split('?')[0]})`);
}
async function todasPaginas(tk, caminho, limite = 50) {
  const out = [];
  for (let pg = 1; pg <= limite; pg++) {
    const lote = await api(tk, `${caminho}${caminho.includes('?') ? '&' : '?'}per_page=200&page=${pg}`);
    if (!lote || !lote.length) break;
    out.push(...lote); if (lote.length < 200) break;
  }
  return out;
}
async function buscarPedido(sb, numero) {
  const tk = await tokenLoja(sb);
  const lista = await api(tk, `/orders?q=${encodeURIComponent(numero)}&per_page=20`) || [];
  const o = lista.find(o => String(o.number) === String(numero)) || null;
  // Prazo previsto (datas) e dados da transportadora vêm das "fulfillment orders"
  if (o && o.id) { try { const fo = await api(tk, `/orders/${o.id}/fulfillment-orders`); if (Array.isArray(fo)) o.fulfillment_orders = fo; } catch (e) {} }
  return o;
}

module.exports = { LOJA, VERSAO, pt, texto, mapaCategorias, produtoParaCatalogo, resumoPedido, telefonesDoPedido, tokenLoja, api, todasPaginas, buscarPedido };
