// Testes do núcleo (sem rede): busca no catálogo, carrinho, travas de resposta.
// Rodar: npm test
const assert = require('assert');
const CAT = require('../netlify/lib/catalogo');
const C = require('../netlify/lib/carrinho');
const W = require('../netlify/lib/wa-nucleo');
const M = require('../netlify/lib/meta-nucleo');
const N = require('../netlify/lib/nuvem');

let ok = 0, falhas = 0;
async function t(nome, fn) { try { await fn(); ok++; console.log('✔', nome); } catch (e) { falhas++; console.log('✘', nome, '\n   ', e.message); } }

// Catálogo de exemplo no formato da API da Nuvemshop → produtoParaCatalogo
const cru = (id, nome, handle, preco, promo, cores, desc) => ({
  id, name: { pt: nome }, handle: { pt: handle }, published: true, brand: 'Condux', tags: '',
  canonical_url: `https://conduxcabos.com.br/produtos/${handle}/`, description: { pt: desc || '' },
  categories: [{ id: 1, name: { pt: 'Cabos por bitola' } }],
  variants: cores.map((c, i) => ({ id: id * 100 + i, values: c ? [{ pt: c }] : [], price: String(preco), promotional_price: promo ? String(promo) : null, stock_management: true, stock: c === 'Verde' ? 0 : 20 }))
});
const catalogo = [
  cru(11, 'Cabo Flexível 1,5 mm² Unipolar 100 Metros Condux 750V', 'cabo-flexivel-15-mm', 110, 99.9, ['Amarelo', 'Azul', 'Preto', 'Verde'], 'Condutor Alucobre. Isolação PVC antichama. 750V. NBR 9117.'),
  cru(12, 'Cabo Flexível 2,5 mm² Unipolar 100 Metros Condux 750V', 'cabo-flexivel-25-mm', 110, 53.25, ['Azul', 'Preto', 'Vermelho']),
  cru(13, 'Cabo Flexível 4,0 mm² Unipolar 100 Metros Condux 750V', 'cabo-flexivel-40-mm', 129, 81.6, ['Preto', 'Azul']),
  cru(14, 'Cabo Flexível 6 mm² Unipolar 100 Metros Condux 750V', 'cabo-flexivel-6-mm', 250, 109.9, ['Azul']),
  cru(15, 'Kit Reforma Essencial (1,5mm + 2,5mm)', 'kit-reforma-essencial', 254.4, 99.9, [''])
].map(p => N.produtoParaCatalogo(p, { 1: 'Cabos por bitola' }));

(async () => {
  await t('produto da Nuvemshop vira linha do catálogo com link de carrinho', () => {
    const p = catalogo[1];
    assert.strictEqual(p.url, 'https://conduxcabos.com.br/produtos/cabo-flexivel-25-mm/');
    assert.strictEqual(p.preco, 53.25); assert.strictEqual(p.preco_de, 110);
    assert.strictEqual(p.variantes.length, 3);
  });
  await t('descrição da Nuvemshop sem entidades HTML (acentos, ²)', () => {
    const p = N.produtoParaCatalogo({ id: 1, name: { pt: 'X' }, handle: { pt: 'x' }, variants: [{ id: 1, values: [], price: '1' }], description: { pt: '<p>Cabo Flex&iacute;vel 1,5 mm&sup2; &eacute; indicado. Isola&ccedil;&atilde;o &#233;</p>' } });
    assert.strictEqual(p.descricao, 'Cabo Flexível 1,5 mm² é indicado. Isolação é');
  });
  await t('busca por bitola "fio 2,5 azul" acha o 2,5 mm² primeiro', () => {
    const r = CAT.buscar(catalogo, 'quero fio 2,5 azul');
    assert.ok(r.length); assert.ok(/2,5 mm/.test(r[0].nome), r.map(x => x.nome).join(' | '));
  });
  await t('busca por "1.5mm" acha o 1,5 mm²', () => {
    const r = CAT.buscar(catalogo, 'tem cabo de 1.5mm?');
    assert.ok(/1,5 mm/.test(r[0].nome), r.map(x => x.nome).join(' | '));
  });
  await t('busca pelo uso "chuveiro" traz 4 e 6 mm²', () => {
    const r = CAT.buscar(catalogo, 'preciso de fio pro chuveiro').map(x => x.nome).join(' | ');
    assert.ok(/4,0 mm/.test(r) && /6 mm/.test(r), r);
  });
  await t('conversa: "o azul" depois de falar de 6mm mantém o 6mm', () => {
    const r = CAT.buscarConversa(catalogo, ['me vê 2 rolos do azul', 'quanto tá o cabo de 6mm?']);
    assert.ok(/6 mm/.test(r[0].nome), r.map(x => x.nome).join(' | '));
  });
  await t('bloco do catálogo leva descrição técnica e [cód]', () => {
    const b = CAT.blocoCatalogo(catalogo, 'fio 1,5', CAT.buscar(catalogo, 'fio 1,5'));
    assert.ok(/\[cód 11\]/.test(b)); assert.ok(/Alucobre/.test(b)); assert.ok(/ESGOTADO|esgotado: Verde/.test(b));
  });
  await t('carrinho resolve cód + cor e gera link /comprar/', () => {
    const r = C.resolverCarrinho(catalogo, [{ cod: 12, variante: 'Azul', qtd: 2 }, { cod: 11, variante: 'Preto', qtd: 1 }]);
    assert.deepStrictEqual(r.erros, []);
    assert.strictEqual(C.linkCarrinho(r.itens), 'https://conduxcabos.com.br/comprar/1200-2,1102-1/');
    assert.ok(Math.abs(C.subtotal(r.itens) - 206.4) < 0.01);
  });
  await t('carrinho recusa cor esgotada e cor inexistente', () => {
    const r = C.resolverCarrinho(catalogo, [{ cod: 11, variante: 'Verde', qtd: 1 }, { cod: 14, variante: 'Preto', qtd: 1 }]);
    assert.strictEqual(r.itens.length, 0); assert.strictEqual(r.erros.length, 2);
    assert.ok(/ESGOTADO/.test(r.erros[0])); assert.ok(/não existe/.test(r.erros[1]));
  });
  await t('kit sem variação entra no carrinho', () => {
    const r = C.resolverCarrinho(catalogo, [{ cod: 15, variante: '', qtd: 1 }]);
    assert.strictEqual(r.itens.length, 1); assert.deepStrictEqual(r.erros, []);
  });
  await t('resumo mostra frete grátis só acima de R$ 150', () => {
    const a = C.resumoCliente(C.resolverCarrinho(catalogo, [{ cod: 12, variante: 'Azul', qtd: 1 }]).itens);
    const b = C.resumoCliente(C.resolverCarrinho(catalogo, [{ cod: 12, variante: 'Azul', qtd: 3 }]).itens);
    assert.ok(!/frete grátis/.test(a)); assert.ok(/frete grátis/.test(b));
    assert.ok(/faltam R\$ 96,75/.test(C.blocoCarrinho(C.resolverCarrinho(catalogo, [{ cod: 12, variante: 'Azul', qtd: 1 }]).itens)));
  });
  await t('rodada: IA fecha o pedido → link real + resumo, sem cupom inventado', async () => {
    const respostaIA = JSON.stringify({ categoria: 'interesse_compra', acao: 'responder', resposta: 'Prontinho! Seu carrinho: {LINK_CARRINHO}', carrinho: [{ cod: 13, variante: 'Preto', qtd: 2 }], enviar_link: true, cupom: 'INVENTADO10' });
    const r = await C.rodadaComCarrinho({ W, perguntar: async () => respostaIA, links: [], catalogo, carrinhoAtual: [], cuponsOk: C.cuponsValidos(null) });
    assert.ok(r.dec.resposta.includes('https://conduxcabos.com.br/comprar/1300-2/'), r.dec.resposta);
    assert.ok(/Seu carrinho/.test(r.dec.resposta)); assert.ok(!/INVENTADO10/.test(r.dec.resposta));
  });
  await t('rodada: carrinho muda → some "faltam R$" calculado no carrinho antigo', async () => {
    const ia = JSON.stringify({ acao: 'responder', resposta: 'Prontinho! Faltam R$ 20,20 para o frete grátis. Quer mais alguma coisa?', carrinho: [{ cod: 12, variante: 'Azul', qtd: 3 }] });
    const r = await C.rodadaComCarrinho({ W, perguntar: async () => ia, links: [], catalogo, carrinhoAtual: [], cuponsOk: [] });
    assert.ok(!/20,20/.test(r.dec.resposta), r.dec.resposta); assert.ok(/Quer mais alguma coisa/.test(r.dec.resposta)); assert.ok(/Subtotal: R\$ 159,75/.test(r.dec.resposta));
  });
  await t('rodada: carrinho inválido 2x → transfere para a equipe', async () => {
    const ruim = JSON.stringify({ acao: 'responder', resposta: 'ok {LINK_CARRINHO}', carrinho: [{ cod: 999, variante: 'Azul', qtd: 1 }], enviar_link: true });
    const r = await C.rodadaComCarrinho({ W, perguntar: async () => ruim, links: [], catalogo, carrinhoAtual: [], cuponsOk: [] });
    assert.strictEqual(r.dec.acao, 'transferir'); assert.strictEqual(r.dec.motivo, 'carrinho_invalido');
  });
  await t('trava: link de fora do domínio → transfere', () => {
    const d = W.interpretarWA(JSON.stringify({ acao: 'responder', resposta: 'Compra aqui: https://mercadolivre.com.br/x' }));
    assert.strictEqual(d.acao, 'transferir'); assert.strictEqual(d.motivo, 'link_externo');
  });
  await t('trava: "cobre puro" e garantia de potência são bloqueados', () => {
    assert.strictEqual(W.interpretarWA(JSON.stringify({ acao: 'responder', resposta: 'Nosso cabo é cobre puro!' })).motivo, 'alegacao_tecnica');
    assert.strictEqual(W.interpretarWA(JSON.stringify({ acao: 'responder', resposta: 'Esse aguenta chuveiro de 7500W tranquilo.' })).motivo, 'alegacao_tecnica');
    assert.strictEqual(W.interpretarWA(JSON.stringify({ acao: 'responder', resposta: 'O 4 mm² é o mais indicado para chuveiro; confirme com seu eletricista.' })).acao, 'responder');
  });
  await t('trava: link inventado no site vira a home da loja', () => {
    const d = W.interpretarWA(JSON.stringify({ acao: 'responder', resposta: 'Veja https://conduxcabos.com.br/produtos/inventado/ e as trocas em https://conduxcabos.com.br/trocas-e-devolucoes/' }));
    assert.ok(d.resposta.includes('Veja https://conduxcabos.com.br e')); assert.ok(d.resposta.includes('trocas-e-devolucoes'));
  });
  await t('CEP não vira número de pedido; "pedido 1234" vira', () => {
    assert.deepStrictEqual(W.extrairPedidos('meu cep é 13300-000'), []);
    assert.deepStrictEqual(W.extrairPedidos('meu pedido é o 1234'), ['1234']);
  });
  await t('horário: sábado 10h fora, terça 10h dentro (Brasília)', () => {
    assert.strictEqual(W.dentroHorario(new Date('2026-09-26T13:00:00Z')), false);
    assert.strictEqual(W.dentroHorario(new Date('2026-09-29T13:00:00Z')), true);
  });
  await t('prompts falam de cabos, sem resto da marca de moda', () => {
    const p = W.montarPromptWA([{ direcao: 'in', texto: 'oi' }], {}, null, 'Ana', new Date(), 'CAT', 'whatsapp', {});
    const m = M.montarPrompt({ plataforma: 'instagram', texto: 'quanto custa?' }, {}, {}, new Date());
    const tudo = p.sistema + p.usuario + m.sistema + m.usuario;
    assert.ok(/Condux/.test(tudo) && /750V/.test(tudo) && /NBR 5410/.test(tudo));
    assert.ok(!/huxter|cueca|calcinha|meia|bruna|primeiravez|cupomextra/i.test(tudo), 'sobrou texto da Huxter');
  });
  await t('comentário: resposta com link é bloqueada; cupom vencido também', () => {
    assert.strictEqual(M.interpretar(JSON.stringify({ categoria: 'interesse', acao: 'responder', resposta: 'Veja https://conduxcabos.com.br' }), {}).acao, 'ignorar');
    assert.strictEqual(M.interpretar(JSON.stringify({ categoria: 'interesse', acao: 'responder', resposta: 'Use o cupom OBRA10!' }), { cupom_codigo: 'OBRA10', cupom_validade: '2020-01-01' }).motivo, 'cupom_vencido');
  });
  console.log(`\n${ok} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
})();
