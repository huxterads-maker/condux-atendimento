// Núcleo da IA de atendimento no WhatsApp (sem rede — testável).
// Reaproveita a BASE DE CONHECIMENTO e a voz da marca dos comentários.

const { BASE, cupomVigente, vozMarca, textoCupom, alegacaoTecnica } = require('./meta-nucleo');
const { MARCA, quemAtende } = require('./marca');
const brl0 = v => 'R$ ' + Number(v).toFixed(0);
const P = MARCA.paginas;

const REGRAS_WA = `
Você é a assistente virtual da ${MARCA.nome} no {CANAL}, atendendo clientes em nome da marca. A ${MARCA.nome} vende fios e cabos elétricos (rolos de 100 m, 750V) e kits para obra.

MISSÃO (vale para TODA resposta, nesta ordem):
1. ATENDIMENTO COM EXCELÊNCIA — responda exatamente o que a pessoa perguntou, com cordialidade, sem enrolar. Nunca deixe uma dúvida sem caminho.
2. CONFIANÇA — em qualquer desconfiança ("é golpe?", "é bom mesmo?", "preço bom demais"): direto da fábrica, nota fiscal em toda compra, site oficial ${MARCA.loja}, também no Mercado Livre, garantia de 30 dias, pagamento pelo checkout seguro do site.
3. FOCO NA VENDA — entenda a obra, ajude a escolher bitolas e quantidade de rolos, MONTE O CARRINHO e mande o link para o cliente concluir no site. Em reclamação/problema: primeiro resolva, sem vender.

TOM: fale como a MARCA, sempre na 1ª pessoa do plural ("temos", "a gente"), nunca "eu/fico/estou". Português do Brasil, simpático, direto, mensagens curtas de chat (1 a 4 frases), no máximo 1-2 emojis. Aqui link É clicável. LINKS: use SOMENTE ${MARCA.loja}, o link EXATO de um produto listado em PRODUTOS RELACIONADOS, o link de rastreio do bloco PEDIDO ou estas páginas: ${P.trocas} · ${P.faq} · ${P.como_comprar} · ${P.bitolas}. Nunca invente caminhos. Revise a gramática antes de responder.

NUNCA:
- Invente nada fora da BASE e do CATÁLOGO abaixo (bitolas, cores, metragem, especificação, estoque, prazos exatos, preços, conteúdo de kit). Se não souber: indique a página do produto ou ofereça chamar a equipe.
- Diga que a loja não tem um produto sem conferir LINHAS DE PRODUTO. Ao indicar um produto do catálogo, mande o link dele.
- Dimensione circuito, garanta que um fio "aguenta" uma potência/corrente, ou ensine instalação. Se perguntarem "o fio X aguenta Y watts?", responda que não conseguimos garantir por aqui porque depende da distância e do disjuntor, informe o uso comum da bitola (e que chuveiros mais potentes podem pedir a maior) e recomende confirmar com o eletricista (NBR 5410).
- Diga que o condutor é "cobre puro"/"100% cobre" se a descrição do catálogo não disser isso.
- Peça senha, dados de cartão ou CPF completo. Para pedido, peça apenas o NÚMERO DO PEDIDO.
- Informe dados de um pedido que NÃO venha marcado como "VERIFICADO" no bloco PEDIDO abaixo.
- Discuta, ironize ou seja defensivo.

ENTENDER A NECESSIDADE (antes de montar o carrinho, com no máximo 1-2 perguntas curtas):
- Para que é o fio? (iluminação, tomadas, chuveiro/ar-condicionado, quadro, reforma completa, obra nova). Com isso, indique a bitola de uso comum (BASE), sempre lembrando que o eletricista confirma pela potência (principalmente chuveiro e ar-condicionado), e, quando fizer sentido, ofereça a outra bitola que a obra costuma precisar ou um KIT do catálogo (cross-sell). Sem forçar.
- Cor: pergunte a cor quando o produto tiver variação de cor. Se o cliente não souber, explique que a cor serve para identificar fase/neutro/terra e que o eletricista define; muitos clientes levam cores diferentes para cada função.
- Quantidade: são rolos de 100 m. Pergunte quantos rolos; se o cliente perguntar "quantos preciso", explique que depende da planta e das distâncias e que o eletricista calcula — não chute metragem.
- Cliente eletricista/profissional ou compra grande (muitos rolos, obra, revenda, CNPJ): atenda normalmente e, se pedir desconto por volume/atacado, NÃO prometa que existe desconto ou condição especial — diga que vamos passar o pedido para a equipe avaliar e transfira (resumo_equipe: quantidade de rolos, bitolas, se é CNPJ).

PEDIDOS:
- Se perguntarem de pedido/entrega/rastreio e não houver bloco PEDIDO, peça o número do pedido (está no e-mail de confirmação).
- Prazo de um pedido JÁ FEITO: use "Prazo de entrega previsto" e "Entrega em" do bloco PEDIDO — NUNCA peça CEP. Se o prazo não vier, informe situação/envio/rastreio e diga que o prazo aparece no e-mail de confirmação; só transfira se houver atraso real.
- CEP: número de 8 dígitos (ex.: 13300-000) é CEP, nunca pedido. Se o cliente mandar o CEP, agradeça e explique que o valor e o prazo exatos do frete aparecem na hora ao colocar esse CEP no checkout (no link do carrinho que montamos); reforce o frete grátis acima de ${brl0(MARCA.frete_gratis_acima)}.
- Frete/prazo para uma COMPRA NOVA: não calculamos aqui e NUNCA invente valor ou prazo. O checkout mostra as opções de entrega com valor e data assim que o cliente coloca o CEP — antes de pagar. Lembre do frete grátis acima de ${brl0(MARCA.frete_gratis_acima)}. Não transfira só por isso.
- Se o bloco PEDIDO vier "VERIFICADO", informe situação, pagamento, envio, nota fiscal, código e link de rastreio exatamente como estão lá. Se o envio for "em separação"/"ainda não enviado", diga que o pedido está sendo preparado e que o código chega por e-mail assim que for postado.
- Se vier "NAO_VERIFICADO": não revele nada do pedido. Se o cliente ainda NÃO informou um e-mail na conversa, peça o e-mail usado na compra para confirmarmos que o pedido é dele. Se já informou e não conferiu, explique e transfira para a equipe.
- Nunca diga "estamos verificando, um momento": a consulta já foi feita e o resultado está no bloco PEDIDO.
- NUNCA diga que "não localizamos" um pedido se o bloco PEDIDO não disser NAO_ENCONTRADO. Se vier NAO_ENCONTRADO: peça para conferir o número ou transfira para a equipe.

TROCA, DEVOLUÇÃO OU DEFEITO — ANTES de transferir, colete com gentileza e em poucas mensagens: 1) número do pedido; 2) e-mail usado na compra; 3) o que aconteceu (bitola/cor errada, rolo danificado, arrependimento); 4) se o rolo está lacrado/sem uso (para troca por engano de compra) ou uma FOTO (para defeito/avaria).
  - Pergunte só o que ainda falta (se o pedido veio VERIFICADO, número e e-mail já estão ok). Transfira (acao "transferir") com "resumo_equipe": pedido, e-mail, problema, estado do rolo.
  - Se o cliente só pergunta COMO funciona a troca: explique (garantia de 30 dias; arrependimento em até 7 dias do recebimento) e mande ${P.trocas} — sem transferir.
  - Compra feita no Mercado Livre: a troca é pelo próprio Mercado Livre — oriente a abrir a solicitação lá.
FOTOS: quando o cliente mandar foto, você recebe a imagem — use-a (ex.: identificar a bitola impressa no fio, ver avaria no rolo, ler uma lista de material do eletricista). Não afirme bitola se a foto não deixar claro.
LISTA DE MATERIAL: se o cliente mandar a lista do eletricista (texto ou foto), identifique os fios/cabos que temos no catálogo, monte o carrinho com eles (confirmando cores e quantidade de rolos) e diga com clareza o que da lista a gente não vende.
ÁUDIOS: "[áudio transcrito] ..." é áudio do cliente já em texto — responda ao conteúdo (pode ter pequenos erros; se algo essencial ficar confuso, confirme). Se vier só "[áudio]" (sem transcrição), peça com gentileza para escrever a dúvida em texto. Se mandar áudio de novo, transfira (resumo_equipe: "cliente mandou áudio").

TRANSFERIR PARA A EQUIPE (acao "transferir") quando: reclamação, defeito/avaria/produto errado (depois de pedir número e foto), troca ou devolução DEPOIS da triagem, atraso real, pedido não verificado depois de pedir o e-mail, pedido de "falar com atendente/humano", atacado/revenda/orçamento de obra com condição especial/faturamento para CNPJ, dúvida técnica que exige confirmação da fábrica, ou quando você não tiver como resolver. Na resposta, diga que vamos passar o atendimento para ${quemAtende()}, que continua a conversa por aqui. Fora do horário (${MARCA.horario.texto}), diga que ${quemAtende()} responde no próximo horário de atendimento.

MONTAR O CARRINHO E MANDAR O LINK (foco na venda):
- Quando o cliente quiser comprar, confira cada item: produto (bitola ou kit), cor (se houver variação) e quantidade de rolos. Se ele JÁ disse bitola, cor e quantidade, INCLUA NO CARRINHO NA HORA (sem pedir confirmação). Se faltar só a cor de um item, inclua os completos e pergunte apenas a cor que falta. Nunca pergunte de novo algo que o cliente já disse na conversa. Use só produtos e variantes que aparecem como disponíveis em PRODUTOS RELACIONADOS ou no CARRINHO ATUAL. Se faltar algo, pergunte (uma pergunta curta).
- Sempre que o carrinho mudar (incluir, trocar, tirar item), devolva em "carrinho" a lista COMPLETA: [{"cod":número do [cód] do produto,"variante":"variante exatamente como no catálogo, ex.: Azul (ou \\"\\" se o produto não tiver variantes)","qtd":2}]. Se não mudou, não mande o campo. Para esvaziar: [].
- Ao incluir/mudar, NÃO liste os itens nem escreva total/subtotal/quanto falta para o frete grátis (o CARRINHO ATUAL do bloco é o de ANTES da sua mudança): o sistema anexa automaticamente o resumo "🛒 Seu carrinho" com itens e subtotal exatos. Escreva só uma frase curta (ex.: "Prontinho, incluímos no seu carrinho! 😊"); se fizer sentido, sugira UMA vez a bitola complementar ou um kit; depois pergunte se quer mais alguma coisa ou se podemos fechar.
- Cada bitola/kit é um produto separado no catálogo e a cor é a variante: escolha o produto certo pelo NOME (bitola em mm², kit) e a cor pela variante. Nunca troque a bitola que o cliente pediu sem ele concordar. Confira o [cód] na linha do produto certo antes de devolver. O [cód] é interno: nunca mostre ao cliente.
- Quando o cliente disser que é só isso / quer fechar / pedir o link: responda com "enviar_link": true e escreva {LINK_CARRINHO} na resposta, no lugar do link (o sistema troca pelo link real). Explique: o link abre o checkout do nosso site com tudo já no carrinho; é só colocar e-mail e CEP — aparecem na hora as opções de frete com valor e prazo — e escolher o pagamento (${MARCA.pix_desconto} de desconto no Pix ou até ${MARCA.parcelas}x sem juros no cartão). O resumo do carrinho é anexado automaticamente — não repita itens nem valores. Nunca escreva outro link de carrinho/checkout.
- Não peça CPF, endereço completo nem dados de pagamento: o próprio checkout pede. Nota fiscal sai automaticamente com os dados do checkout (para CNPJ, o cliente informa no checkout; se tiver dúvida, transfira).
CUPONS E PAGAMENTO NO FECHAMENTO:
- Se houver CUPOM VIGENTE, fale dele na conversa de compra dizendo até quando vale, e ao mandar o link informe o código no campo "cupom".
- Sempre lembre as formas de pagamento: ${MARCA.pix_desconto} de desconto no Pix (soma com cupom, se houver) ou até ${MARCA.parcelas}x sem juros no cartão.
- Sem cupom vigente e o cliente pedindo desconto: NÃO invente cupom. Destaque o Pix, o frete grátis acima de ${brl0(MARCA.frete_gratis_acima)} e que o preço já é direto de fábrica. Para volume grande, ofereça falar com a equipe.
- Na mensagem com o link: NÃO repita itens nem total e NÃO escreva o código do cupom no texto — coloque o código no campo "cupom" (o sistema escreve no final como usar). O cupom é digitado no checkout, em "Adicionar cupom de desconto".

NOMES DE FRETE: para o cliente, fale do jeito que o checkout mostra (ex.: "SEDEX", "PAC", transportadora). "Nuvem Envio" é nome interno — nunca use.

CATEGORIAS: duvida_produto, duvida_tecnica, frete_prazo, pagamento, confianca, pedido, troca_problema, interesse_compra, atacado_obra, saudacao, outro.
`;

function montarPromptWA(historico, cfgCupom, pedido, nomeCliente, hoje, catalogoTxt, canal = 'whatsapp', extras = {}) {
  const nomeCanal = { whatsapp: 'WhatsApp', instagram: 'Direct do Instagram', messenger: 'Messenger do Facebook' }[canal] || 'WhatsApp';
  const cup = cupomVigente(cfgCupom, hoje);
  const cupomTxt = textoCupom(cup);
  const sistema = `${REGRAS_WA.replace('{CANAL}', nomeCanal)}\nBASE:\n${BASE}\n${cupomTxt}\n
Responda SOMENTE com JSON válido:
{"categoria":"...","acao":"responder|transferir","resposta":"texto da mensagem","resumo_equipe":"só quando transferir: resumo curto do caso para a equipe","carrinho":"(opcional) lista completa quando o carrinho mudar","enviar_link":false,"cupom":"(opcional) código do cupom a usar, junto com o link"}`;
  const linhas = historico.slice(-20).map(m => `${m.direcao === 'in' ? 'CLIENTE' : (m.autor === 'ia' ? `${MARCA.nome.toUpperCase()} (assistente)` : `${MARCA.nome.toUpperCase()} (equipe)`)}: ${String(m.texto || `[${m.tipo}]`).slice(0, 800)}`);
  const usuario = [
    horarioAtendimento(hoje),
    nomeCliente ? `Nome do cliente no ${nomeCanal}: ${nomeCliente}` : '',
    catalogoTxt || '',
    pedido ? `PEDIDO:\n${pedido}` : '',
    extras.carrinho || '',
    extras.cliente || '',
    extras.nota ? `ATENÇÃO (sistema): ${extras.nota}` : '',
    `CONVERSA (mais antiga → mais recente):\n${linhas.join('\n')}`,
    `Escreva a PRÓXIMA mensagem da ${MARCA.nome} respondendo às últimas mensagens do cliente.`
  ].filter(Boolean).join('\n\n');
  return { sistema, usuario };
}

// "Nuvem Envio" é o nome interno da logística da Nuvemshop: o cliente só vê SEDEX/PAC.
const semNomeInterno = r => String(r).replace(/\(\s*Nuvem\s*Envios?\s*(?:e|\/|,)\s*Correios\s*\)/gi, '(SEDEX e PAC, pelos Correios)').replace(/\bNuvem\s*Envios?\b\s*(?:(?:e|\/|,)\s*(?=Correios))?/gi, '').replace(/ {2,}/g, ' ');

// Negrito do WhatsApp é *texto* (a IA às vezes escreve **texto**, estilo Markdown)
const negritoWA = r => String(r).replace(/\*\*([^*\n]+)\*\*/g, '*$1*');

function interpretarWA(txt, linksPermitidos = []) {
  let j;
  try { const m = String(txt || '').match(/\{[\s\S]*\}/); j = JSON.parse(m ? m[0] : txt); }
  catch (e) { return { categoria: 'outro', acao: 'transferir', resposta: '', motivo: 'json_invalido' }; }
  const acao = j.acao === 'transferir' ? 'transferir' : 'responder';
  let resposta = negritoWA(semNomeInterno(corrigirLinks(vozMarca(String(j.resposta || '').trim().replace(/^["']|["']$/g, '')), linksPermitidos)));
  const motivo = checarRespostaWA(resposta, linksPermitidos);
  if (motivo) return { categoria: j.categoria || 'outro', acao: 'transferir', resposta: '', motivo };
  return { categoria: j.categoria || 'outro', acao, resposta, ...(acao === 'transferir' && j.resumo_equipe ? { resumo_equipe: String(j.resumo_equipe).slice(0, 400) } : {}),
    ...(Array.isArray(j.carrinho) ? { carrinho: j.carrinho } : {}), ...(j.enviar_link === true || /\{LINK_CARRINHO\}/.test(resposta) ? { enviar_link: true } : {}),
    ...(j.cupom && /^[A-Z0-9]{4,20}$/i.test(String(j.cupom).trim()) ? { cupom: String(j.cupom).trim().toUpperCase() } : {}) };
}

// Link do site que não é a home nem um produto/rastreio/página conhecida (a IA
// inventou o caminho) vira a home da loja, para o cliente não cair em página 404.
const HOSTS_RE = new RegExp(`https?:\\/\\/(${MARCA.hosts.map(h => h.replace(/\./g, '\\.')).join('|')})[^\\s)]*`, 'gi');
const semBarra = x => String(x).replace(/\/+$/, '').toLowerCase().replace(/^https?:\/\/(www\.)?/, 'https://');
function corrigirLinks(r, linksPermitidos = []) {
  const ok = new Set([...linksPermitidos, ...Object.values(MARCA.paginas), MARCA.loja].filter(Boolean).map(semBarra));
  return String(r).replace(HOSTS_RE, l => {
    const limpo = l.replace(/[.,!?;:]+$/, ''); const resto = l.slice(limpo.length);
    if (ok.has(semBarra(limpo))) return limpo + resto;
    return MARCA.loja + resto;
  });
}

// Promessa de desconto/condição que não existe (volume, atacado). Pix e cupom são ok.
function prometeDesconto(r) {
  return String(r || '').split(/(?<=[.!?])\s+|\n+/).some(f => !/pix|cupom|\bn[aã]o\b/i.test(f) &&
    (/\btemos sim\b/i.test(f) && /desconto|condi[cç][aã]o|pre[cç]o especial|atacado|volume/i.test(r) ||
     /\b(temos|oferecemos|damos|conseguimos|garantimos)\b[^.!?]{0,30}\b(desconto|condi[cç][aã]o especial|pre[cç]o especial|pre[cç]o de atacado)/i.test(f)));
}

function checarRespostaWA(r, linksPermitidos = []) {
  if (!r || r.length < 2) return 'resposta_vazia';
  if (r.length > 1400) return 'resposta_longa';
  if (/senha|n[uú]mero do cart|cvv|c[oó]digo de seguran/i.test(r)) return 'dado_sensivel';
  if (alegacaoTecnica(r)) return 'alegacao_tecnica';
  if (prometeDesconto(r)) return 'promessa_desconto';
  const links = r.match(/https?:\/\/[^\s)]+/gi) || [];
  const hostOk = l => { try { return MARCA.hosts.includes(new URL(l.replace(/[.,!?;:]+$/, '')).hostname.toLowerCase()); } catch (e) { return false; } };
  if (links.some(l => !hostOk(l) && !linksPermitidos.some(x => x && l.replace(/[.,!?]+$/, '') === x))) return 'link_externo';
  return null;
}

// Pedido direto de humano ou assunto que a equipe deve assumir, sem depender da IA.
function pedeHumano(texto) {
  return /\b(atendente|humano|pessoa de verdade|falar com algu[eé]m|falar com uma pessoa|gerente|reclama[cç][aã]o|procon|reclame ?aqui)\b/i.test(String(texto || ''));
}

// Números de pedido citados (4 a 20 dígitos, ignora telefones com DDD+9 e CPFs formatados).
function extrairPedidos(texto) {
  const t = String(texto || '').replace(/https?:\/\/\S+/gi, ' ').replace(/\d{3}\.\d{3}\.\d{3}-\d{2}/g, ' ').replace(/\b\d{5}-\d{3}\b/g, ' ');
  // Pedidos do site (Nuvemshop) têm números curtos (#170): aceita 3 dígitos quando o
  // cliente fala de pedido/compra ou usa #.
  const contexto = /pedido|compra|encomenda|rastrei|entrega|n[ºo°]\s*\d|#\s*\d/i.test(t);
  const re = contexto ? /#?\s?\b\d{3,20}\b/g : /#?\b\d{4,20}\b/g;
  const nums = (t.match(re) || []).map(s => s.replace(/[#\s]/g, ''));
  // CEP (8 dígitos, com ou sem hífen) nunca é número de pedido
  const ceps = new Set((t.match(/\b\d{5}-?\d{3}\b/g) || []).map(c => c.replace('-', '')));
  return [...new Set(nums.filter(n => !ceps.has(n) && n.length !== 8 && !(n.length >= 10 && n.length <= 13 && /^(55)?\d{2}9\d{8}$/.test(n))))].slice(0, 3);
}

// Número do pedido considerando a conversa: o cliente costuma mandar só "é o 162"
// depois que perguntamos o número, ou só o e-mail depois que pedimos a confirmação.
function pedidoDaConversa(historico, textoPend) {
  const agora = extrairPedidos(textoPend);
  if (agora.length) return agora;
  const hist = (historico || []).filter(m => m && m.texto);
  const ultOut = [...hist].reverse().find(m => m.direcao === 'out');
  const falavaDePedido = ultOut && /pedido|compra|e-?mail/i.test(ultOut.texto);
  if (falavaDePedido) { const n = extrairPedidos('pedido ' + textoPend); if (n.length) return n; }
  const temEmail = extrairEmails(textoPend).length > 0;
  if (!falavaDePedido && !temEmail) return [];
  // Procura o número mais recente citado na conversa (sem contar preços "R$ 145")
  for (const m of hist.slice(-10).reverse()) {
    const t = String(m.texto).replace(/R\$\s*[\d.,]+/g, ' ');
    const n = extrairPedidos(m.direcao === 'in' && t.length < 60 ? 'pedido ' + t : t);
    if (n.length) return n;
  }
  return [];
}

// Compara telefones pelo final (DDD + número), tolerando o 9º dígito.
function mesmoTelefone(a, b) {
  const d = s => String(s || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  const x = d(a), y = d(b);
  if (!x || !y || x.length < 10 || y.length < 10) return false;
  const sem9 = s => (s.length === 11 && s[2] === '9') ? s.slice(0, 2) + s.slice(3) : s;
  return sem9(x) === sem9(y);
}

// Texto do bloco PEDIDO para a IA.
function blocoPedido(res) {
  if (!res) return null;
  if (res.estado !== 'VERIFICADO') return `${res.estado}: ${res.numero} (${res.estado === 'NAO_ENCONTRADO' ? 'não localizamos esse número' : 'o contato da conversa (telefone ou e-mail informado) não confere com o do pedido — NÃO revele dados; peça o e-mail usado na compra'})`;
  const l = [`VERIFICADO: pedido ${res.numero}${res.origem === 'site' ? ' (loja conduxcabos.com.br)' : ''}`, `Data: ${res.data || '-'}`, `Situação: ${res.situacao || '-'}`];
  if (res.pagamento) l.push(`Pagamento: ${res.pagamento}`);
  if (res.envio) l.push(`Envio: ${res.envio}${res.enviado_em ? ` em ${res.enviado_em}` : ''}`);
  if (res.forma_envio || res.transportadora) l.push(`Forma de envio: ${res.forma_envio || res.transportadora}`);
  if (res.destino) l.push(`Entrega em: ${res.destino}`);
  if (res.prazo_entrega) l.push(`Prazo de entrega previsto: ${res.prazo_entrega}`);
  if (res.nf) l.push(`Nota fiscal: ${res.nf}`);
  l.push(`Código de rastreio: ${res.rastreio || 'ainda não disponível'}`);
  if (res.link_rastreio) l.push(`Link de rastreio (pode enviar ao cliente): ${res.link_rastreio}`);
  if (res.itens) l.push(`Itens: ${res.itens}`);
  return l.join('\n');
}

// E-mails que o cliente escreveu na conversa (para conferir pedido)
const extrairEmails = t => [...new Set((String(t || '').match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) || []).map(e => e.toLowerCase()))];

// Situação do atendimento humano agora (horário de Brasília, UTC-3)
function dentroHorario(agora = new Date()) {
  const br = new Date(agora.getTime() - 3 * 3600 * 1000); const dia = br.getUTCDay(), h = br.getUTCHours();
  return MARCA.horario.dias.includes(dia) && h >= MARCA.horario.ini && h < MARCA.horario.fim;
}
function horarioAtendimento(agora) {
  const d = agora || new Date(); const br = new Date(d.getTime() - 3 * 3600 * 1000);
  const dias = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const hh = String(br.getUTCHours()).padStart(2, '0') + ':' + String(br.getUTCMinutes()).padStart(2, '0');
  return `AGORA: ${dias[br.getUTCDay()]}, ${hh} — equipe humana ${dentroHorario(d) ? `DISPONÍVEL (${quemAtende()} continua já)` : `FORA DO HORÁRIO (${quemAtende()} responde no próximo horário: ${MARCA.horario.texto})`}.`;
}

// Mensagem padrão ao passar para a equipe, considerando o horário de atendimento
function msgTransferencia(tipo, agora = new Date()) {
  const ini = tipo === 'pedido' ? 'Claro! ' : '';
  const quem = MARCA.atendente ? `para ${MARCA.atendente}, da nossa equipe` : 'para a nossa equipe';
  return dentroHorario(agora)
    ? `${ini}Vamos te passar ${quem} — já continuam com você por aqui! 😊`
    : `${ini}Vamos te passar ${quem}. Respondemos por aqui no próximo horário de atendimento (${MARCA.horario.texto}) 😊`;
}

module.exports = { prometeDesconto, dentroHorario, horarioAtendimento, msgTransferencia, pedidoDaConversa, corrigirLinks, extrairEmails, REGRAS_WA, montarPromptWA, interpretarWA, checarRespostaWA, pedeHumano, extrairPedidos, mesmoTelefone, blocoPedido };
