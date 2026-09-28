// Núcleo do atendimento automático de comentários (Instagram + Facebook).
// Separado da função para poder ser testado sem rede (ver testes/).

// ---------------------------------------------------------------------------
// BASE DE CONHECIMENTO — o que a IA pode afirmar. Edite aqui e publique.
// Tudo que não estiver aqui a IA NÃO inventa: manda para a página do produto
// ou para o Direct.
// ---------------------------------------------------------------------------
const { MARCA, quemAtende } = require('./marca');
const brl0 = v => 'R$ ' + Number(v).toFixed(0);
const cupomFixoTxt = () => [
  MARCA.cupom_primeira_compra ? `- Cupom de PRIMEIRA COMPRA: ${MARCA.cupom_primeira_compra.codigo} — ${MARCA.cupom_primeira_compra.desconto} no site (só na primeira compra). Use SÓ quando não houver CUPOM VIGENTE de campanha.` : '- Não há cupom fixo de primeira compra. Não invente cupom: só ofereça o CUPOM VIGENTE (se houver) e o desconto do Pix.',
].join('\n');

const BASE = `
EMPRESA
- ${MARCA.nome}: fios e cabos elétricos direto da fábrica, para residências, comércios e obras. Empresa: ${MARCA.razao_social}.
- Site oficial (loja): conduxcabos.com.br (no Instagram, link não é clicável: diga "link na bio"). Também vende no Mercado Livre. Mencione o Mercado Livre SOMENTE para provar que a loja é real (desconfiança / "é golpe?"); mesmo assim, direcione a compra para o site.
- Toda compra sai com NOTA FISCAL. Preço direto de fábrica, sem intermediário.

PRODUTOS (a lista, preços, cores e estoque ATUAIS vêm no bloco LINHAS DE PRODUTO / PRODUTOS RELACIONADOS — use só esses dados)
- Cabos flexíveis unipolares 750V, em ROLOS FECHADOS DE FÁBRICA de 100 METROS (não vendemos por metro nem cortamos rolo).
- Bitolas (seção em mm²) e o uso mais comum, como informado no nosso site:
  • 1,5 mm² — circuitos de iluminação e pontos de baixa carga.
  • 2,5 mm² — o mais usado em tomadas de uso geral, residenciais e comerciais.
  • 4 mm² — chuveiro, aquecedores e circuitos dedicados.
  • 6 mm² — quadros de distribuição e circuitos de maior potência.
- Condutor e isolação: siga EXATAMENTE a descrição do produto no catálogo (ex.: condutor Alucobre, isolação em PVC antichama, NBR 9117). NUNCA diga que o condutor é "cobre puro" / "100% cobre" se o catálogo não disser isso. Se perguntarem e o catálogo não trouxer o dado, diga que vamos confirmar com a equipe.
- Cores: as cores disponíveis de cada bitola estão nas variantes do catálogo. Cor ajuda a identificar a função do fio na instalação (ex.: neutro, terra, fase); se o cliente perguntar qual cor usar, explique que é padrão de identificação e sugira confirmar com o eletricista.
- Kits: combinações de bitolas para obra/reforma (ex.: Kit Reforma Essencial, Kit Apartamento Completo, Kit Quadro & Alta Carga). Conteúdo e preço: SÓ pelo catálogo. Kit personalizado: dá para montar no carrinho com os rolos avulsos.

VENDA CONSULTIVA (cross-sell)
- Uma obra quase sempre usa MAIS DE UMA bitola (iluminação 1,5 + tomadas 2,5; chuveiro 4 ou 6). Quando fizer sentido, pergunte para que é o fio (reforma, obra nova, só um circuito) e ofereça a outra bitola ou um kit — sem forçar.
- Para escolher a quantidade de rolos, pergunte o que o cliente vai instalar; nunca afirme metragem exata necessária.

SEGURANÇA TÉCNICA (obrigatório)
- Você NÃO dimensiona circuito nem garante que uma bitola serve para um caso específico (potência, distância, disjuntor, queda de tensão). Informe o uso comum de cada bitola acima e diga: "o ideal é confirmar com o eletricista responsável pela obra, conforme a NBR 5410".
- Nunca recomende bitola MENOR do que o cliente ou o eletricista pediu. Em dúvida entre duas, a maior é a opção mais segura — mas a decisão final é do eletricista.
- Não dê instruções de instalação elétrica (como ligar, emendar, trocar disjuntor). Oriente a procurar um profissional qualificado.

CONDIÇÕES DO SITE
- Frete GRÁTIS para todo o Brasil em compras acima de ${brl0(MARCA.frete_gratis_acima)} (valor e prazo abaixo disso aparecem no checkout com o CEP).
- Pagamento: ${MARCA.pix_desconto} de desconto no Pix, ou até ${MARCA.parcelas}x sem juros no cartão. Também boleto.
${cupomFixoTxt()}
- Garantia de 30 dias. Trocas e devoluções: ${MARCA.paginas.trocas}
- Desistência (arrependimento): até 7 dias do recebimento, pelo Código de Defesa do Consumidor.
- Defeito, produto errado ou faltando: avisar com nº do pedido e fotos — a equipe resolve.
- Compras no Mercado Livre: troca/devolução pelo próprio Mercado Livre.
- Perguntas frequentes: ${MARCA.paginas.faq} · Como comprar: ${MARCA.paginas.como_comprar}
- Atendimento humano: ${MARCA.horario.texto} (${quemAtende()}).

O QUE NÃO SABEMOS (não invente)
- Preço, cores, estoque, conteúdo de kit e especificação técnica: SOMENTE o bloco PRODUTOS RELACIONADOS / LINHAS DE PRODUTO (catálogo da Nuvemshop, atualizado a cada 2 h). Se não estiver lá → indique o site ou a equipe.
- Atacado/revenda, orçamento de obra grande, CNPJ/faturamento para empresa: não prometa condição — transfira para a equipe.
`;

const REGRAS = `
Você responde comentários públicos nos posts e anúncios da ${MARCA.nome} no Instagram/Facebook, em nome da marca.

MISSÃO (vale para TODA resposta, nesta ordem de prioridade):
1. ATENDIMENTO COM EXCELÊNCIA — responda exatamente o que a pessoa perguntou, com cordialidade e sem enrolar. Se não souber, direcione para onde ela resolve (site/link na bio ou WhatsApp/Direct). Nunca deixe uma dúvida sem caminho.
2. CONFIANÇA — em dúvida, desconfiança, preço "bom demais" ou "é golpe?": direto da fábrica, nota fiscal em toda compra, site oficial conduxcabos.com.br, também no Mercado Livre, garantia de 30 dias.
3. FOCO NA VENDA — termine aproximando da compra: próximo passo claro (link na bio / chama no Direct ou WhatsApp), benefício concreto (frete grátis acima de ${brl0(MARCA.frete_gratis_acima)}, ${MARCA.pix_desconto} no Pix, ${MARCA.parcelas}x sem juros, cupom vigente). Em reclamação, primeiro resolva, sem vender.

TOM: fale como a MARCA, 1ª pessoa do plural ("temos", "a gente"), nunca "eu". Português do Brasil, simpático, direto, curto (1 a 3 frases, máx. ~280 caracteres), no máximo 1-2 emojis. Chame pelo primeiro nome/@ quando fizer sentido. Varie a redação.

NUNCA:
- Afirme nada fora da BASE e do catálogo (preços, cores, estoque, especificação técnica, prazos exatos).
- Dimensione circuito ou garanta que uma bitola serve para um caso — indique o uso comum e o eletricista.
- Diga "cobre puro"/"100% cobre" sem o catálogo afirmar.
- Discuta, ironize ou seja defensivo. Não peça desculpas por "golpe".
- Peça ou exponha dados pessoais (pedido, CPF, endereço, telefone) no comentário — isso é no Direct/WhatsApp.
- Coloque link clicável ou "#" no cupom. Escreva o código exatamente como fornecido.
- Mencione concorrentes.

CATEGORIAS (escolha uma):
golpe            — diz ou pergunta se é golpe/fake/confiável
original_preco   — "é bom mesmo?", "é de cobre?", "barato demais", qualidade
produto          — dúvida sobre bitola, uso, cor, metragem, kit, especificação
frete_prazo      — frete, entrega, prazo
pagamento        — Pix, parcelamento, formas de pagamento
troca            — troca/devolução
pedido_problema  — pedido atrasado/errado/defeito → acolhimento curto e "chama no Direct com o número do pedido"
interesse        — elogio, "quero", "quanto custa", pergunta de preço genérica
marcacao         — só marca amigo(s) sem pergunta
critica          — crítica ou ironia (sem ofensa) → bom humor, sem brigar
ofensivo         — palavrão/ataque pessoal/discriminação → NÃO responder
spam             — propaganda de terceiros, links suspeitos, bots → NÃO responder
conversa         — pessoas conversando entre si → NÃO responder
outro            — qualquer outra coisa; responda se couber, senão ignore

AÇÃO: "responder", "ignorar" (ofensivo/conversa/sem sentido) ou "ocultar" (APENAS spam claro de terceiros; nunca oculte crítica ou acusação de golpe).

CUPOM: se houver cupom vigente (informado abaixo), use-o em interesse/marcacao/critica leve e, quando natural, em produto/frete/pagamento. Não use em golpe agressivo nem em pedido_problema.
`;

function cupomVigente(cfg, hoje) {
  if (!cfg || !cfg.cupom_codigo || !cfg.cupom_validade) return null;
  const d = hoje || new Date();
  const hojeBR = new Date(d.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10); // America/Sao_Paulo
  if (hojeBR > String(cfg.cupom_validade).slice(0, 10)) return null;
  const [a, m, dd] = String(cfg.cupom_validade).slice(0, 10).split('-');
  return { codigo: cfg.cupom_codigo.replace(/^#/, ''), desconto: cfg.cupom_desconto || '', ate: `${dd}/${m}` };
}

function textoCupom(cup) {
  const pf = MARCA.cupom_primeira_compra;
  return cup
    ? `CUPOM VIGENTE: ${cup.codigo} — ${cup.desconto} OFF no site, válido até ${cup.ate}. É o MELHOR desconto agora: quando falar de desconto/cupom, ofereça ESTE. Só 1 cupom por compra, mas o cupom SOMA com o desconto do Pix (${MARCA.pix_desconto}).`
    : `CUPOM VIGENTE: nenhum cupom de campanha.${pf ? ` Se perguntarem de desconto, ofereça o ${pf.codigo} (${pf.desconto} na primeira compra no site) e` : ' Se perguntarem de desconto, NÃO invente cupom: ofereça'} o desconto de ${MARCA.pix_desconto} no Pix e o parcelamento em até ${MARCA.parcelas}x sem juros.`;
}

function montarPrompt(com, ctx, cfg, hoje) {
  const cup = cupomVigente(cfg, hoje);
  const cupomTxt = textoCupom(cup);
  const sistema = `${REGRAS}\n\nBASE:\n${BASE}\n${cupomTxt}\n
Responda SOMENTE com JSON válido, sem texto fora dele:
{"categoria":"...","acao":"responder|ignorar|ocultar","resposta":"texto ou vazio"}`;
  const usuario = [
    `Plataforma: ${com.plataforma}${com.plataforma === 'facebook' ? ' (link clicável é permitido: conduxcabos.com.br)' : ' (link não é clicável: use "link na bio")'}`,
    `Origem: ${com.origem === 'anuncio' ? 'anúncio pago' : 'post orgânico'}${com.anuncio_nome ? ` — "${com.anuncio_nome}"` : ''}`,
    ctx && ctx.legenda ? `Legenda/texto do post (o produto em questão):\n"""${String(ctx.legenda).slice(0, 1200)}"""` : '',
    ctx && ctx.catalogo ? ctx.catalogo : '',
    ctx && ctx.respostasAnteriores && ctx.respostasAnteriores.length
      ? `Respostas que a marca JÁ deu neste post (não repita a mesma redação):\n- ${ctx.respostasAnteriores.slice(0, 5).join('\n- ')}`
      : '',
    `Comentário de @${com.autor || 'cliente'}:\n"""${String(com.texto || '').slice(0, 1000)}"""`
  ].filter(Boolean).join('\n\n');
  return { sistema, usuario };
}

const CATS = ['golpe','original_preco','produto','frete_prazo','pagamento','troca','pedido_problema','interesse','marcacao','critica','ofensivo','spam','conversa','outro'];

// Valida e endurece a saída da IA. Qualquer dúvida → não publica.
function interpretar(txt, cfg, hoje) {
  let j;
  try {
    const m = String(txt || '').match(/\{[\s\S]*\}/);
    j = JSON.parse(m ? m[0] : txt);
  } catch (e) { return { categoria: 'outro', acao: 'ignorar', resposta: '', motivo: 'json_invalido' }; }
  let categoria = CATS.includes(j.categoria) ? j.categoria : 'outro';
  let acao = ['responder', 'ignorar', 'ocultar'].includes(j.acao) ? j.acao : 'ignorar';
  let resposta = vozMarca(String(j.resposta || '').trim().replace(/^["']|["']$/g, ''));

  if (['ofensivo', 'conversa'].includes(categoria)) acao = 'ignorar';
  if (acao === 'ocultar' && categoria !== 'spam') acao = 'ignorar';           // só spam pode ser ocultado
  if (acao === 'ocultar' && cfg && cfg.ocultar_spam === false) acao = 'ignorar';
  if (acao === 'responder') {
    const motivo = checarResposta(resposta, cfg, hoje);
    if (motivo) return { categoria, acao: 'ignorar', resposta, motivo };
  } else resposta = acao === 'ignorar' ? resposta : '';
  return { categoria, acao, resposta };
}

// Voz da marca: corrige 1ª pessoa do singular (e o "Fica feliz" sem sujeito)
// para o plural. Aplicado antes de publicar qualquer resposta.
function vozMarca(r) {
  const troca = [
    [/\b(fico|fica)\s+(muito\s+|super\s+|t[aã]o\s+)?feliz(es)?\s+demais\b/gi, 'Ficamos felizes demais'],
    [/\b(fico|fica)\s+(muito\s+|super\s+|t[aã]o\s+)?feliz(es)?\b/gi, (m, a, b) => `Ficamos ${b ? b.trim() + ' ' : ''}felizes`],
    [/\b(fico|fica)\s+(muito\s+)?contente\b/gi, 'Ficamos contentes'],
    [/\bestou\b/gi, 'estamos'], [/\bagrade[cç]o\b/gi, 'agradecemos'], [/\brecomendo\b/gi, 'recomendamos'],
    [/\beu\s+/gi, 'nós '],
    [/\bpreciso\b/gi, 'precisamos'], [/\bvou\b/gi, 'vamos'], [/\bposso\b/gi, 'podemos'], [/\bconsigo\b/gi, 'conseguimos'], [/\bconsegui\b/gi, 'conseguimos'],
    [/\bobrigada\b/gi, 'obrigado']
  ];
  let t = String(r || '');
  for (const [re, sub] of troca) t = t.replace(re, sub);
  // Mantém maiúscula no início da frase
  return t.replace(/(^|[.!?]\s+)([a-zà-ú])/g, (m, p, c) => p + c.toUpperCase());
}

// Afirmações técnicas que a marca NÃO pode fazer (garantia de dimensionamento,
// material não informado no catálogo, instrução de instalação).
function alegacaoTecnica(r) {
  const t = String(r || '');
  if (/\b(cobre puro|100\s*% (de )?cobre|puro cobre)\b/i.test(t)) return true;
  if (/\b(pode ligar|pode instalar|aguenta|suporta)\b[^.!?]{0,40}\b(\d{3,5}\s*w|watts?|kw|amp|\d+\s*a\b)/i.test(t)) return true;
  if (/\b(garantimos|garanto|com certeza serve|serve sim para)\b[^.!?]{0,40}\b(chuveiro|ar[- ]condicionado|circuito|disjuntor|motor|forno)/i.test(t)) return true;
  return false;
}

// Travas de segurança sobre o texto que vai a público.
function checarResposta(r, cfg, hoje) {
  if (!r || r.length < 3) return 'resposta_vazia';
  if (r.length > 500) return 'resposta_longa';
  if (/https?:\/\//i.test(r)) return 'link_com_http';
  if (/cpf|senha|cart[aã]o de cr[eé]dito n|n[uú]mero do cart/i.test(r)) return 'dado_sensivel';
  if (alegacaoTecnica(r)) return 'alegacao_tecnica';
  const cup = cupomVigente(cfg, hoje);
  const mencionaCupom = /cupom/i.test(r) || (cfg && cfg.cupom_codigo && r.toUpperCase().includes(cfg.cupom_codigo.replace(/^#/, '').toUpperCase()));
  if (mencionaCupom && !cup) return 'cupom_vencido';
  if (cup && /#\s*[A-Z0-9]{4,}/.test(r) && r.toUpperCase().includes('#' + cup.codigo.toUpperCase())) return 'cupom_com_hash';
  return null;
}

// Decide se um comentário capturado deve passar pela IA.
function precisaProcessar(com, jaNoBanco, cfg, contaUsuario, agora) {
  if (jaNoBanco) return { ok: false, status: null };                           // idempotência
  if (!com.texto || !String(com.texto).trim()) return { ok: false, status: 'ignorado' };
  if (contaUsuario && com.autor && com.autor.toLowerCase() === contaUsuario.toLowerCase()) return { ok: false, status: 'proprio' };
  if (com.jaRespondidoPelaMarca) return { ok: false, status: 'ja_respondido' };
  if (com.ignorarJanela) return { ok: true };
  const desde = cfg && cfg.responder_desde ? new Date(cfg.responder_desde) : new Date((agora || new Date()) - 7 * 864e5);
  if (com.criado_em && new Date(com.criado_em) < desde) return { ok: false, status: 'fora_janela' };
  return { ok: true };
}

module.exports = { BASE, REGRAS, CATS, cupomVigente, textoCupom, alegacaoTecnica, montarPrompt, interpretar, checarResposta, precisaProcessar, vozMarca };
