// Catálogo da loja (conduxcabos.com.br / Nuvemshop): leitura das páginas de produto
// e busca dos produtos relevantes para a pergunta do cliente. Sem rede nas
// funções de parse/busca — testáveis.

const { MARCA } = require('./marca');
const LOJA = MARCA.loja;

const decodeHtml = s => String(s || '').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
const decodeJsStr = s => String(s || '').replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\\//g, '/').replace(/\\'/g, "'");
const texto = html => decodeHtml(String(html || '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|h\d|tr|div)>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

function urlsDoSitemap(xml) {
  return [...new Set([...String(xml).matchAll(/<loc>\s*(https?:\/\/[^<\s]*\/produtos\/[^<\s]+)\s*<\/loc>/g)].map(m => m[1].replace(/^http:/, 'https:')))];
}

function parseProduto(html, url) {
  const meta = (prop) => { const m = html.match(new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]+content="([^"]*)"`, 'i')) || html.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="${prop}"`, 'i')); return m ? decodeHtml(m[1]) : null; };
  let variantes = [];
  const mv = html.match(/LS\.variants\s*=\s*(\[[\s\S]*?\]);/);
  if (mv) { try { variantes = JSON.parse(mv[1]); } catch (e) { variantes = []; } }
  if (!variantes.length) {
    const dv = html.match(/data-variants="([^"]+)"/);
    if (dv) { try { variantes = JSON.parse(decodeHtml(dv[1])); } catch (e) {} }
  }
  const nome = meta('og:title') || (html.match(/<title>([^<]+)<\/title>/i) || [])[1];
  if (!nome || !variantes.length) return null;
  // Breadcrumb (JSON-LD WebPage) → categoria
  let categoria = null;
  const bloco = (html.match(/"@type":\s*"BreadcrumbList"[\s\S]*?\]\s*\}/) || [])[0];
  if (bloco) {
    const nomes = [...bloco.matchAll(/"name":\s*"([^"]+)"/g)].map(m => decodeJsStr(m[1]));
    const meio = nomes.slice(1, -1);
    if (meio.length) categoria = meio.join(' > ');
  }
  // Sem categoria no breadcrumb: deduz pela URL/nome
  if (!categoria) {
    const base = (url + ' ' + (nome || '')).toLowerCase();
    categoria = /\bkit\b/.test(base) ? 'Kits' : /cabo|fio/.test(base) ? 'Cabos flexíveis' : 'Outros';
  }
  const lsProd = (html.match(/LS\.product\s*=\s*\{([\s\S]*?)\n\s*\};?/) || [])[1] || '';
  const marca = decodeJsStr((lsProd.match(/brand\s*:\s*'([^']*)'/) || [])[1] || '') || null;
  const tags = [...((lsProd.match(/tags\s*:\s*\[([\s\S]*?)\]/) || [])[1] || '').matchAll(/'([^']*)'/g)].map(m => decodeJsStr(m[1]).toLowerCase()).filter(Boolean);
  const produto_id = variantes[0].product_id || +((lsProd.match(/id\s*:\s*(\d+)/) || [])[1] || 0) || null;
  // Descrição completa (inclui tabela de medidas quando existe)
  let descricao = meta('description') || '';
  const iDesc = html.indexOf('data-store="product-description');
  if (iDesc > -1) {
    const t = texto(html.slice(iDesc, iDesc + 12000).replace(/^[^>]*>/, ''));
    if (t.length > descricao.length) descricao = t;
  }
  descricao = descricao.replace(/^Descrição\s*/i, '').slice(0, 1800);
  const vs = variantes.filter(v => v.is_visible !== false).map(v => ({
    opcoes: [v.option0, v.option1, v.option2].filter(x => x != null && x !== ''),
    estoque: v.stock == null ? null : +v.stock, disponivel: !!v.available, preco: v.price_number != null ? +v.price_number : null,
    preco_de: v.compare_at_price_number != null ? +v.compare_at_price_number : null
  }));
  const precos = vs.map(v => v.preco).filter(x => x != null);
  const dispo = vs.filter(v => v.disponivel);
  return {
    url: url.replace(/^http:/, 'https:'), produto_id, nome: decodeHtml(nome).trim(), categoria, marca, tags,
    preco: precos.length ? Math.min(...precos) : null,
    preco_de: (vs.find(v => v.preco_de) || {}).preco_de || null,
    disponivel: dispo.length > 0,
    estoque_total: vs.reduce((s, v) => s + (v.estoque || 0), 0),
    variantes: vs, descricao, imagem: meta('og:image'), ativo: true, atualizado_em: new Date().toISOString()
  };
}

// ------------------------------- Busca ---------------------------------------
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ');
const SIN = {
  cabo: ['cabo', 'fio', 'flexivel', 'cabinho', 'rolo', 'bobina'], kit: ['kit', 'combo', 'conjunto'],
  preto: ['preto', 'preta'], branco: ['branco', 'branca'], vermelho: ['vermelho', 'vermelha'], azul: ['azul'], verde: ['verde'],
  amarelo: ['amarelo', 'amarela'], cinza: ['cinza'], marrom: ['marrom'], cores: ['cores', 'colorido', 'sortido']
};
// Uso → bitola de uso comum (só para achar o produto; a IA confirma com o cliente)
const USO = [
  [/ilumina|luz|lampada|lustre|spot|interruptor/, ['1_5']],
  [/tomada|geladeira|microondas|tv\b|computador/, ['2_5']],
  [/chuveiro|aquecedor|ar condicionado|ar cond|split|forno|cooktop|torneira eletrica|secadora/, ['4', '6']],
  [/quadro|entrada|padrao|disjuntor geral|alimentador|medidor/, ['6']],
  [/reforma|apartamento|casa toda|obra/, ['1_5', '2_5', '4']]
];
// Bitolas citadas: "1,5", "1.5mm", "2,5 mm²", "fio 4", "cabo de 6", "10mm"
function bitolasDe(txt) {
  const t = String(txt || '').toLowerCase().replace(/²/g, '').replace(/\bmm2\b/g, 'mm');
  const out = new Set();
  for (const m of t.matchAll(/\b(\d{1,2})\s*[,.]\s*(\d)\s*(?:mm)?\b/g)) out.add(m[2] === '0' ? m[1] : `${m[1]}_${m[2]}`);
  for (const m of t.matchAll(/\b(\d{1,2})\s*(?:mm|milimetros?)\b/g)) out.add(m[1] === '15' ? '1_5' : m[1] === '25' ? '2_5' : m[1]);
  for (const m of t.matchAll(/\b(?:fio|cabo|bitola|rolo)s?\s+(?:de\s+|do\s+)?(\d{1,2})\b(?![,.]\d)(?!\s*(?:rolos?|metros?|m\b|un|pe[cç]as?|x))/g)) out.add(m[1] === '15' ? '1_5' : m[1] === '25' ? '2_5' : m[1]);
  return [...out].filter(b => /^(0_5|0_75|1|1_5|2_5|4|6|10|16|25|35|50)$/.test(b));
}
const usosDe = txt => { const n = norm(txt); const out = new Set(); for (const [re, bs] of USO) if (re.test(n)) bs.forEach(b => out.add(b)); return [...out]; };
const bitolasProduto = p => bitolasDe(p.nome);
const PARADAS = new Set('para com que tem voces vcs voce qual quais quanto custa preco valor sobre uma uns umas dos das nos nas isso esse essa quero queria gostaria sim nao pode tambem mais muito boa bom dia tarde noite ola oi obrigado obrigada ainda vende vendem metros metro unipolar 750v'.split(' '));
function termos(q) {
  const n = norm(q); const out = new Set();
  for (const [chave, alts] of Object.entries(SIN)) if (alts.some(a => n.includes(a))) alts.forEach(a => out.add(a)), out.add(chave);
  for (let w of n.split(/\s+/)) { if (w.length < 3 || PARADAS.has(w)) continue; if (w.length > 4 && w.endsWith('s')) w = w.slice(0, -1); out.add(w); }
  return [...out];
}
// ts: termos; bq: bitolas citadas; bu: bitolas pelo uso
function pontuar(p, ts, bq = [], bu = []) {
  const nome = norm(p.nome), cat = norm(p.categoria), tg = norm((p.tags || []).join(' ')), ds = norm(String(p.descricao || '').slice(0, 400));
  let s = 0;
  for (const t of ts) { if (nome.includes(t)) s += 3; if (cat.includes(t)) s += 2; if (tg.includes(t)) s += 1; if (ds.includes(t)) s += 1; }
  const bp = bitolasProduto(p);
  if (bq.length && bp.some(b => bq.includes(b))) s += 6 * bp.filter(b => bq.includes(b)).length;
  if (bu.length && bp.some(b => bu.includes(b))) s += 3;
  const cores = (p.variantes || []).map(v => norm((v.opcoes || []).join(' '))).join(' ');
  for (const t of ts) if (t.length > 3 && cores.includes(t)) s += 1;
  return s;
}
function buscar(catalogo, pergunta, n = 8) {
  const ts = termos(pergunta), bq = bitolasDe(pergunta), bu = usosDe(pergunta);
  if (!ts.length && !bq.length && !bu.length) return [];
  return catalogo.filter(p => p.ativo !== false).map(p => {
    let s = pontuar(p, ts, bq, bu);
    if (s && p.disponivel) s += 1;
    return { p, s };
  }).filter(x => x.s >= 3).sort((a, b) => b.s - a.s).slice(0, n).map(x => x.p);
}
// Produtos para a conversa: a mensagem atual vale em dobro, e as anteriores do
// cliente dão o contexto (ex.: falou "reforma" antes e agora diz só "o de 2,5 azul").
// textos: [mensagem atual, anterior, ...] (mais recente primeiro)
function buscarConversa(catalogo, textos, n = 12) {
  const ts = (textos || []).filter(Boolean);
  if (ts.length <= 1) return buscar(catalogo, ts[0] || '', 10);
  const ant = ts.slice(1, 4).join('\n');
  const tA = termos(ts[0]), tB = termos(ant), bA = bitolasDe(ts[0]), bB = bitolasDe(ant), uA = usosDe(ts[0]), uB = usosDe(ant);
  if (!tA.length && !tB.length && !bA.length && !bB.length && !uA.length && !uB.length) return [];
  return catalogo.filter(p => p.ativo !== false).map(p => {
    const sA = pontuar(p, tA, bA, uA), sB = pontuar(p, tB, bB, uB);
    let s = 2 * sA + sB;
    if (s && p.disponivel) s += 1;
    return { p, s, ok: sA >= 3 || sB >= 6 };
  }).filter(x => x.ok && x.s >= 6).sort((a, b) => b.s - a.s).slice(0, n).map(x => x.p);
}
const brl = v => v == null ? '' : 'R$ ' + Number(v).toFixed(2).replace('.', ',');
function linhaProduto(p, comMedidas, comCod) {
  const tams = (p.variantes || []).filter(v => v.disponivel).map(v => v.opcoes.join('/')).filter(Boolean);
  const semEstoque = (p.variantes || []).filter(v => !v.disponivel).map(v => v.opcoes.join('/')).filter(Boolean);
  const partes = [`- ${comCod && p.produto_id ? `[cód ${p.produto_id}] ` : ''}${p.nome}`, `${brl(p.preco)}${p.preco_de && p.preco_de > p.preco ? ` (de ${brl(p.preco_de)})` : ''}`,
    p.disponivel ? (tams.length ? `variantes disponíveis: ${tams.join(', ')}` : 'disponível') : 'ESGOTADO',
    semEstoque.length && p.disponivel ? `esgotado: ${semEstoque.join(', ')}` : '', p.url].filter(Boolean);
  let l = partes.join(' | ');
  if (comMedidas && p.descricao) l += `\n  Descrição/especificação (use só isto para dados técnicos): ${String(p.descricao).replace(/\s+/g, ' ').slice(0, 700)}`;
  return l;
}
// Resumo do que a loja vende (sempre vai para a IA)
function resumoLinhas(catalogo) {
  const g = {};
  for (const p of catalogo.filter(x => x.ativo !== false)) {
    const k = p.categoria || 'Outros'; g[k] = g[k] || { n: 0, min: Infinity, max: 0, disp: 0, marcas: {} };
    g[k].n++; if (p.disponivel) g[k].disp++;
    const mc = p.marca ? String(p.marca).trim().replace(/\b\w/g, c => c.toUpperCase()).replace(/\B\w/g, c => c.toLowerCase()) : null;
    if (mc) g[k].marcas[mc] = (g[k].marcas[mc] || 0) + 1; if (p.preco != null) { g[k].min = Math.min(g[k].min, p.preco); g[k].max = Math.max(g[k].max, p.preco); }
  }
  return Object.entries(g).sort().map(([k, v]) => `- ${k}: ${v.n} produtos (${v.disp} com estoque)${v.min < Infinity ? `, de ${brl(v.min)} a ${brl(v.max)}` : ''}${Object.keys(v.marcas).length ? ` — marcas: ${Object.entries(v.marcas).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m} (${n})`).join(', ')}` : ''}`).join('\n');
}
function blocoCatalogo(catalogo, pergunta, achadosProntos, comCod = !!achadosProntos) {
  if (!catalogo || !catalogo.length) return null;
  const achados = achadosProntos || buscar(catalogo, pergunta);
  return [`LINHAS DE PRODUTO DA LOJA (catálogo atual do site):\n${resumoLinhas(catalogo)}`,
    achados.length ? `PRODUTOS RELACIONADOS À PERGUNTA (use SÓ estes dados de preço/cor/estoque/especificação):\n${achados.map((p, i) => linhaProduto(p, i < 3, comCod)).join('\n')}` : 'Nenhum produto específico encontrado para a pergunta — use as linhas acima e indique o site.'
  ].join('\n\n');
}

// Carrega o catálogo do banco com cache de 10 min por instância da função
let _cache = null, _quando = 0;
async function carregarCatalogo(sb) {
  if (_cache && Date.now() - _quando < 10 * 60 * 1000) return _cache;
  try { _cache = await sb('catalogo?ativo=eq.true&select=url,produto_id,nome,categoria,marca,tags,preco,preco_de,disponivel,variantes,descricao&limit=2000'); _quando = Date.now(); }
  catch (e) { _cache = _cache || []; }
  return _cache;
}

module.exports = { bitolasDe, usosDe, buscarConversa, carregarCatalogo, LOJA, urlsDoSitemap, parseProduto, buscar, termos, blocoCatalogo, resumoLinhas, linhaProduto };
