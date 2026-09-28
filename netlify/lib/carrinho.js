// Carrinho montado pela IA na conversa → link que abre o checkout do site
// (https://conduxcabos.com.br/comprar/{variante}-{qtd},{variante}-{qtd}/) com os
// produtos já no carrinho. O checkout calcula o frete (SEDEX/PAC) com o CEP e
// tem o campo de cupom. Também identifica se o cliente já comprou no site
// (para oferecer o cupom certo). Funções de carrinho não usam rede (testáveis).
const { MARCA } = require('./marca');
const LOJA = MARCA.loja;
const FG = MARCA.frete_gratis_acima;
const crypto = require('crypto');
// Telefone → hash (DDD + número, sem o 9º dígito e sem +55). Nunca guardamos o número.
function hashTel(t) {
  let d = String(t || '').replace(/\D/g, '').replace(/^0+/, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11 && d[2] === '9') d = d.slice(0, 2) + d.slice(3);
  return d.length === 10 ? crypto.createHash('sha256').update('condux-tel:' + d).digest('hex') : null;
}
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const urlChave = u => norm(u).replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
const brl = v => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A opção do produto ("Cinza", "38-43", "Azul Marinho") aparece como palavra
// inteira no texto que a IA escreveu ("Cinza / 38-43")?
const temOpcao = (txt, op) => new RegExp(`(^|[\\s/,|;()+])${escRe(norm(op))}($|[\\s/,|;()+])`).test(norm(txt));

// itens: [{ url, variante, qtd }] (formato que a IA devolve)
// → { itens: [{url, nome, variante, opcoes, variant_id, qtd, preco}], erros: [texto] }
function resolverCarrinho(catalogo, itens) {
  const porUrl = {}, porCod = {};
  for (const p of catalogo || []) { if (p.url) porUrl[urlChave(p.url)] = p; if (p.produto_id) porCod[String(p.produto_id)] = p; }
  const out = [], erros = [];
  for (const it of (Array.isArray(itens) ? itens : []).slice(0, 15)) {
    if (!it) continue;
    const cod = String(it.cod || it.produto || it.produto_id || '').replace(/\D/g, '');
    const p = (cod && porCod[cod]) || porUrl[urlChave(it.url)];
    const qtd = Math.max(1, Math.min(50, parseInt(it.qtd || it.quantidade || 1, 10) || 1));
    if (!p) { erros.push(`"${cod || it.url || it.nome || '?'}" não é código de produto do catálogo — use o [cód] exato de PRODUTOS RELACIONADOS ou do CARRINHO ATUAL.`); continue; }
    const vs = (p.variantes || []).filter(v => v && v.id);
    if (!vs.length) { erros.push(`${p.nome}: produto ainda sem código de variação (catálogo sincronizando) — mande o link do produto em vez do carrinho.`); continue; }
    const txt = Array.isArray(it.variante) ? it.variante.join(' / ') : String(it.variante || '');
    // Variação única: aceita se a IA não informou variante ou se ela confere (cor pedida
    // diferente da única disponível → erro, para a IA avisar o cliente).
    const unicaOk = vs.length === 1 && (!txt.trim() || !(vs[0].opcoes || []).length || vs[0].opcoes.every(o => temOpcao(txt, o)));
    let cand = vs.length === 1 ? (unicaOk ? vs : []) : vs.filter(v => (v.opcoes || []).length && v.opcoes.every(o => temOpcao(txt, o)));
    if (cand.length > 1) cand = cand.filter(v => norm(v.opcoes.join(' / ')) === norm(txt.replace(/\s*[,|;]\s*/g, ' / '))).concat(cand).slice(0, 1);
    const v = cand[0];
    const opcoesDisp = vs.filter(x => x.disponivel).map(x => x.opcoes.join(' / ')).join(', ');
    if (!v) { erros.push(`${p.nome}: variação "${txt || '(não informada)'}" não existe. Disponíveis: ${opcoesDisp || 'nenhuma'}.`); continue; }
    if (!v.disponivel) { erros.push(`${p.nome} ${v.opcoes.join(' / ')}: ESGOTADO. Disponíveis: ${opcoesDisp || 'nenhuma'}.`); continue; }
    if (v.estoque != null && v.estoque < qtd) { erros.push(`${p.nome} ${v.opcoes.join(' / ')}: só temos ${v.estoque} em estoque (cliente pediu ${qtd}).`); continue; }
    const ja = out.find(x => x.variant_id === v.id);
    if (ja) { ja.qtd = Math.min(50, ja.qtd + qtd); continue; }
    out.push({ cod: p.produto_id || null, url: p.url, nome: p.nome, variante: v.opcoes.join(' / '), opcoes: v.opcoes, variant_id: v.id, qtd, preco: v.preco != null ? +v.preco : p.preco });
  }
  return { itens: out, erros };
}

// Remove frases que citam valor de subtotal/total ou quanto falta para o frete grátis
function semValoresAntigos(txt) {
  const ruim = /(falta(m)?|faltando|subtotal|total)[^.!?\n]{0,60}R\$\s*[\d.,]+|R\$\s*[\d.,]+[^.!?\n]{0,40}(para o frete|pro frete|de frete gr[aá]tis)/i;
  return String(txt).split('\n').map(l => ruim.test(l) ? l.split(/(?<=[.!?])\s+/).filter(f => !ruim.test(f)).join(' ') : l).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const linkCarrinho = itens => itens && itens.length ? `${LOJA}/comprar/${itens.map(i => `${i.variant_id}-${i.qtd}`).join(',')}/` : null;
const subtotal = itens => (itens || []).reduce((s, i) => s + (i.preco || 0) * i.qtd, 0);

// Resumo do carrinho para o cliente (vai junto da resposta)
function resumoCliente(itens) {
  const st = subtotal(itens);
  const nomeCurto = n => String(n).replace(/[.\s]+$/, '');
  return `🛒 *Seu carrinho*\n${itens.map(i => `• ${i.qtd}x ${nomeCurto(i.nome)}${i.variante ? ` (${i.variante})` : ''} — ${brl(i.preco * i.qtd)}`).join('\n')}\n*Subtotal: ${brl(st)}*${st >= FG ? ' · frete grátis ✅' : ''}`;
}

function blocoCarrinho(itens) {
  if (!itens || !itens.length) return 'CARRINHO ATUAL: vazio.';
  const st = subtotal(itens);
  return `CARRINHO ATUAL (já montado nesta conversa — ao mudar, devolva a lista COMPLETA em "carrinho"):\n${itens.map(i => `- ${i.qtd}x [cód ${i.cod || '?'}] ${i.nome} | variante: ${i.variante || '(única)'} | ${brl(i.preco)} cada | ${i.url}`).join('\n')}\nSubtotal dos produtos: ${brl(st)}${st >= FG ? ` (já tem FRETE GRÁTIS: acima de ${brl(FG)})` : ` (faltam ${brl(FG - st)} para o FRETE GRÁTIS acima de ${brl(FG)} — se fizer sentido para a obra, sugira mais um rolo ou a bitola complementar)`}`;
}

// ----------------------------- Cliente --------------------------------------
// Já comprou no site? Procura o cadastro na Nuvemshop pelo e-mail informado na
// conversa e, no WhatsApp, pelo telefone. → { tipo: 'antigo'|'novo'|'desconhecido', por }
async function identificarCliente(N, sb, { telefone, emails = [], mesmoTelefone }) {
  const tk = await N.tokenLoja(sb);
  const comprou = c => c && (Number(c.total_spent) > 0 || !!c.last_order_id);
  for (const e of emails.slice(0, 3)) {
    const lista = (await N.api(tk, `/customers?q=${encodeURIComponent(e)}&per_page=10`)) || [];
    const c = lista.find(x => norm(x.email) === norm(e));
    if (comprou(c)) return { tipo: 'antigo', por: 'email' };
    if (!c) {
      // Cadastro pode não existir (compra como visitante): confere pedidos com o e-mail
      const ped = (await N.api(tk, `/orders?q=${encodeURIComponent(e)}&per_page=5`)) || [];
      if (ped.some(o => norm(o.contact_email || (o.customer && o.customer.email)) === norm(e) && o.payment_status === 'paid')) return { tipo: 'antigo', por: 'email' };
    }
  }
  const h = hashTel(telefone);
  if (h) {
    const r = (await sb(`nuvem_clientes_tel?hash=eq.${h}&select=comprou`).catch(() => []))[0];
    if (r && r.comprou) return { tipo: 'antigo', por: 'telefone' };
  }
  return emails.length ? { tipo: 'novo', por: 'email' } : { tipo: 'desconhecido', por: null };
}

function blocoCliente(res) {
  if (!res) return null;
  const rc = MARCA.cupom_recompra, pc = MARCA.cupom_primeira_compra;
  if (res.tipo === 'antigo') return `CLIENTE: JÁ COMPROU no site (encontrado pelo ${res.por}). Trate como cliente da casa.${rc ? ` Se ele PEDIR desconto (e não houver cupom de campanha maior): ${rc.codigo} (${rc.desconto}).` : ''}`;
  if (res.tipo === 'novo') return `CLIENTE: NOVO — nenhuma compra no site com o e-mail informado.${pc ? ` Se ele PEDIR desconto (e não houver cupom de campanha maior): ${pc.codigo} (${pc.desconto}).` : ''}`;
  return 'CLIENTE: ainda não sabemos se já comprou no site.';
}

// Cupons que o sistema aceita anexar ao link (fixos da marca + campanha vigente)
const cuponsValidos = cupomVig => [MARCA.cupom_primeira_compra, MARCA.cupom_recompra].filter(Boolean).map(c => c.codigo.toUpperCase()).concat(cupomVig ? [cupomVig.codigo.toUpperCase()] : []);

// Precisa saber se o cliente já comprou? (carrinho em andamento ou conversa de preço/desconto)
const precisaCliente = (carrinhoAtual, texto) => (carrinhoAtual && carrinhoAtual.length > 0) || /desconto|cupom|caro|barat|valor|pre[cç]o|frete|fechar|comprar|j[aá] comprei|primeira compra/i.test(texto || '');

// Uma rodada da IA com o carrinho: interpreta, valida o carrinho no catálogo e
// troca {LINK_CARRINHO} pelo link real. Se o carrinho vier inválido, pede à IA
// para corrigir (1 vez); se ainda assim não der para gerar o link, transfere.
// perguntar(nota) → texto cru da IA. → { dec, carrinho, mudou, erros }
async function rodadaComCarrinho({ W, perguntar, links, catalogo, carrinhoAtual, cuponsOk }) {
  const atual = Array.isArray(carrinhoAtual) ? carrinhoAtual : [];
  let nota = null;
  for (let t = 0; t < 2; t++) {
    const dec = W.interpretarWA(await perguntar(nota), links);
    if (dec.acao === 'transferir') { delete dec.carrinho; delete dec.enviar_link; return { dec, carrinho: atual, mudou: false, erros: [] }; }
    let novo = atual, erros = [];
    if (dec.carrinho) { const r = resolverCarrinho(catalogo, dec.carrinho); novo = r.itens; erros = r.erros; }
    if (dec.enviar_link && !novo.length) erros.push('O carrinho está vazio: inclua os itens no campo "carrinho" antes de usar {LINK_CARRINHO}.');
    if (erros.length && t === 0) {
      nota = `sua resposta anterior NÃO foi enviada ao cliente. Problemas no carrinho: ${erros.join(' ')} Corrija o "carrinho" (use o [cód] e a variante exatos do catálogo) ou, se o item não existir/estiver esgotado, avise o cliente e ofereça as opções disponíveis (sem {LINK_CARRINHO}).`;
      continue;
    }
    const mudou = !!dec.carrinho; delete dec.carrinho;
    // Carrinho mudou nesta resposta: frases com valores de frete/subtotal que a IA
    // calculou sobre o carrinho ANTIGO saem do texto (o resumo do sistema é o certo).
    if (mudou) dec.resposta = semValoresAntigos(dec.resposta);
    if (!dec.enviar_link) delete dec.cupom;
    // Carrinho mudou: o resumo (itens e subtotal) é escrito pelo sistema, a partir
    // do que realmente vai no link — nunca pelo texto da IA.
    if (mudou && novo.length && !dec.enviar_link) dec.resposta = `${dec.resposta}\n\n${resumoCliente(novo)}`;
    if (dec.enviar_link) {
      delete dec.enviar_link;
      if (erros.length) return { dec: { categoria: dec.categoria, acao: 'transferir', resposta: '', motivo: 'carrinho_invalido', resumo_equipe: `Cliente quer fechar a compra, mas a IA não conseguiu montar o carrinho: ${erros.join(' ')}`.slice(0, 400) }, carrinho: atual, mudou: false, erros };
      const l = linkCarrinho(novo);
      dec.resposta = /\{LINK_CARRINHO\}/.test(dec.resposta) ? dec.resposta.replace(/\{LINK_CARRINHO\}/g, l) : `${dec.resposta}\n\n${l}`;
      dec.resposta += `\n\n${resumoCliente(novo)}`;
      // Cupom no final da mensagem (só códigos conhecidos)
      if (dec.cupom && (cuponsOk || []).includes(dec.cupom)) {
        // tira do texto da IA as frases que já citam o cupom (ele vai no final)
        const re = new RegExp(escRe(dec.cupom), 'i');
        dec.resposta = dec.resposta.split('\n').map(l => re.test(l) ? l.split(/(?<=[.!?])\s+/).filter(f => !re.test(f)).join(' ') : l).join('\n').replace(/\n{3,}/g, '\n\n');
      }
      if (dec.cupom && (cuponsOk || []).includes(dec.cupom)) dec.resposta += `\n\n🎟️ Use o cupom *${dec.cupom}* no checkout, em "Adicionar cupom de desconto".`;
      dec.link_carrinho = l;
    }
    return { dec, carrinho: novo, mudou, erros };
  }
}

module.exports = { semValoresAntigos, cuponsValidos, resumoCliente, hashTel, precisaCliente, rodadaComCarrinho, resolverCarrinho, linkCarrinho, subtotal, blocoCarrinho, identificarCliente, blocoCliente, urlChave };
