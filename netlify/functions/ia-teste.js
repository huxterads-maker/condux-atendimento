// Netlify Function: ia-teste.js — simulador da IA de atendimento (só painel logado).
// POST { canal: 'whatsapp'|'instagram'|'messenger', telefone?: '11999998888',
//        mensagens: [{ direcao: 'in'|'out', texto }] }
// Usa exatamente a mesma IA, catálogo da Nuvemshop e consulta de pedido do
// atendimento real, mas NÃO grava nada e NÃO envia mensagem a ninguém.
const W = require('../lib/wa-nucleo');
const CAT = require('../lib/catalogo');
const { proteger } = require('../lib/guarda');
const R = require('./wa-responder-background')._interno;
const C = require('../lib/carrinho');
const { cupomVigente } = require('../lib/meta-nucleo');
const N = require('../lib/nuvem');
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const SBH = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' };
const sb = async (p) => { const r = await fetch(`${SB_URL}/rest/v1/${p}`, { headers: SBH }); const t = await r.text(); if (!r.ok) throw new Error(t.slice(0, 200)); return t ? JSON.parse(t) : null; };
const json = (c, b) => ({ statusCode: c, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(b) });

const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { erro: 'use POST' });
  let b; try { b = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { erro: 'JSON inválido' }); }
  const canal = ['whatsapp', 'instagram', 'messenger'].includes(b.canal) ? b.canal : 'whatsapp';
  const msgs = (b.mensagens || []).filter(m => m && m.texto).slice(-30).map(m => ({ direcao: m.direcao === 'out' ? 'out' : 'in', autor: m.direcao === 'out' ? 'ia' : 'cliente', texto: String(m.texto).slice(0, 1500) }));
  if (!msgs.length || msgs[msgs.length - 1].direcao !== 'in') return json(400, { erro: 'A última mensagem deve ser do cliente.' });
  // Telefone simulado (WhatsApp) para testar a conferência do pedido
  const tel = String(b.telefone || '').replace(/\D/g, '');
  const wa_id = canal === 'whatsapp' ? (tel ? (tel.startsWith('55') ? tel : '55' + tel) : '5500000000000') : (canal === 'instagram' ? 'ig_teste' : 'fb_teste');
  try {
    const pend = []; for (let i = msgs.length - 1; i >= 0 && msgs[i].direcao === 'in'; i--) pend.unshift(msgs[i]);
    const textoPend = pend.map(m => m.texto).join('\n');
    const passos = [];
    if (/^\s*excluir\s*[.!]?\s*$/i.test(textoPend)) return json(200, { acao: 'excluir', resposta: 'Pronto! Excluímos o histórico do seu atendimento com a Condux, conforme a LGPD. Se precisar de algo, é só chamar 💙', passos: ['Palavra EXCLUIR: no atendimento real, o histórico do cliente é apagado.'] });
    if (W.pedeHumano(textoPend)) return json(200, { acao: 'transferir', categoria: 'outro', resposta: W.msgTransferencia('pedido'), passos: ['Cliente pediu atendente: transfere direto para a equipe (IA pausa).'] });
    const cupomCfg = (await sb('meta_config?id=eq.1&select=cupom_codigo,cupom_desconto,cupom_validade').catch(() => [{}]))[0] || {};
    const cupomVig = cupomVigente(cupomCfg);
    let pedidoTxt = null, linkRastreio = null;
    const nums = W.pedidoDaConversa(msgs, textoPend);
    if (nums.length) {
      const emails = W.extrairEmails(msgs.filter(m => m.direcao === 'in').map(m => m.texto).join('\n'));
      try {
        const res = await R.consultarPedido(nums[0], wa_id, emails);
        pedidoTxt = W.blocoPedido(res); if (res && res.estado === 'VERIFICADO') linkRastreio = res.link_rastreio || null;
        passos.push(`Pedido ${nums[0]}: ${res.estado}${res.origem === 'site' ? ' (Nuvemshop)' : ''}`);
      } catch (e) { pedidoTxt = `NAO_VERIFICADO: ${nums[0]} (sistema de pedidos indisponível agora)`; passos.push(`Pedido ${nums[0]}: erro na consulta (${e.message})`); }
    }
    const recentes = msgs.filter(m => m.direcao === 'in').slice(-4).map(m => m.texto).join('\n');
    const catalogo = await CAT.carregarCatalogo(sb);
    const busca = textoPend + '\n' + recentes;
    const anteriores = msgs.slice(0, msgs.length - pend.length).filter(m => m.direcao === 'in').slice(-3).reverse().map(m => m.texto);
    const achadosP = CAT.buscarConversa(catalogo, [textoPend, ...anteriores]); const achados = achadosP.map(p => p.nome);
    const catalogoTxt = CAT.blocoCatalogo(catalogo, busca, achadosP);
    if (achados.length) passos.push(`Produtos encontrados no catálogo (${achados.length}): ${achadosP.map(p => `${p.nome} [${p.produto_id}]`).join('; ')}`);
    // Carrinho da conversa simulada (a página devolve o que recebeu na rodada anterior)
    const carrinhoAtual = Array.isArray(b.carrinho) ? b.carrinho.slice(0, 15) : [];
    let clienteTxt = null;
    if (C.precisaCliente(carrinhoAtual, msgs.slice(-8).map(m => m.texto).join('\n'))) {
      try {
        const cli = await C.identificarCliente(N, sb, { telefone: canal === 'whatsapp' && tel ? wa_id : null, emails: W.extrairEmails(msgs.filter(m => m.direcao === 'in').map(m => m.texto).join('\n')), mesmoTelefone: W.mesmoTelefone });
        clienteTxt = C.blocoCliente(cli); passos.push(`Cliente: ${cli.tipo === 'antigo' ? 'já comprou no site' : cli.tipo === 'novo' ? 'novo (sem compras com o e-mail)' : 'ainda não identificado'}`);
      } catch (e) { passos.push(`Cliente: não consegui consultar (${e.message})`); }
    }
    // Foto de teste (opcional): { mime, base64 } da última mensagem do cliente
    const imagens = (b.imagem && /^image\/(jpeg|png|webp|gif)$/.test(b.imagem.mime) && String(b.imagem.base64 || '').length < 5e6) ? [{ mime: b.imagem.mime, base64: b.imagem.base64 }] : [];
    if (imagens.length) passos.push('Foto enviada para a IA analisar');
    const r = await C.rodadaComCarrinho({
      W, catalogo, carrinhoAtual, cuponsOk: C.cuponsValidos(cupomVig),
      links: [linkRastreio, ...achadosP.map(p => p.url), ...carrinhoAtual.map(i => i.url)],
      perguntar: nota => { if (nota) passos.push(`Carrinho corrigido pela IA: ${nota.slice(0, 200)}`); return R.perguntarIA(W.montarPromptWA(msgs, cupomCfg, pedidoTxt, b.nome || null, undefined, catalogoTxt, canal, { carrinho: C.blocoCarrinho(carrinhoAtual), cliente: clienteTxt, nota }), imagens); }
    });
    const dec = r.dec;
    if (r.mudou) passos.push(`Carrinho: ${r.carrinho.map(i => `${i.qtd}x ${i.nome} (${i.variante})`).join('; ') || 'vazio'}`);
    if (dec.link_carrinho) passos.push(`Link do carrinho gerado (subtotal R$ ${C.subtotal(r.carrinho).toFixed(2).replace('.', ',')})`);
    if (dec.acao === 'transferir' && !dec.resposta) dec.resposta = W.msgTransferencia();
    if (dec.motivo) passos.push(`Transferência: ${dec.motivo}`);
    dec.carrinho = r.carrinho;
    return json(200, { ...dec, passos });
  } catch (e) { return json(500, { erro: e.message }); }
};
exports.handler = proteger(handler);
