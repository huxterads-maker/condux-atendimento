// Netlify Background Function: wa-responder-background.js
// Disparada pelo whatsapp-webhook a cada mensagem nova (?wa_id=5511...).
// 1) Trava a conversa (uma resposta por vez), espera alguns segundos para
//    juntar mensagens seguidas do cliente.
// 2) Se a equipe assumiu a conversa (modo humano), não responde — até passar
//    wa_config.horas_pausa_humano sem a equipe falar; aí volta para a IA.
// 3) Se o cliente citou um número de pedido, consulta a Nuvemshop e só libera
//    os dados para a IA se o telefone (ou o e-mail informado) for o do pedido.
// 4) IA (Claude) escreve a resposta ou decide transferir para a equipe.
// 5) modo "automatico": envia pelo WhatsApp; "simulacao": só grava.
//
// Variáveis: WA_TOKEN (ou META_TOKEN com permissões do WhatsApp), ANTHROPIC_API_KEY.

const W = require('../lib/wa-nucleo');
const CAT = require('../lib/catalogo');
const N = require('../lib/nuvem');
const DM = require('../lib/meta-dm');
const C = require('../lib/carrinho');
const { cupomVigente } = require('../lib/meta-nucleo');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const GV = process.env.META_API_VERSION || 'v23.0';
const MODELO = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SBH = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' };

async function sb(path, opt = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...opt, headers: { ...SBH, ...(opt.headers || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`Supabase ${r.status} ${path.split('?')[0]}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}
const log = (msg, nivel = 'info') => sb('wa_log', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ msg: String(msg).slice(0, 2000), nivel }) }).catch(() => {});
const waToken = () => process.env.WA_TOKEN || process.env.META_TOKEN;

// ------------------------------ WhatsApp ------------------------------------
async function waPost(phoneId, payload) {
  const r = await fetch(`https://graph.facebook.com/${GV}/${phoneId}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${waToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`WhatsApp: ${(j.error && (j.error.error_user_msg || j.error.message)) || r.status}`);
  return j;
}
const enviarTexto = (phoneId, to, body) => waPost(phoneId, { recipient_type: 'individual', to, type: 'text', text: { preview_url: true, body } });
const lidoDigitando = (phoneId, message_id) => waPost(phoneId, { status: 'read', message_id, typing_indicator: { type: 'text' } }).catch(() => {});

// ------------------------------- Pedidos ------------------------------------
// Pedido do site (Nuvemshop): status, pagamento, envio e rastreio.
// Confere se o pedido é da pessoa: mesmo telefone do WhatsApp OU e-mail da
// compra informado pelo cliente na conversa (Direct/Messenger não têm telefone).
const confereContato = (wa_id, emails) => ({
  tel: t => !DM.ehDM(wa_id) && W.mesmoTelefone(t, wa_id),
  email: e => !!e && (emails || []).includes(String(e).trim().toLowerCase())
});
async function consultarPedido(numero, wa_id, emails = []) {
  const cc = confereContato(wa_id, emails);
  const o = await N.buscarPedido(sb, numero);          // erro de rede/token sobe para quem chamou
  if (!o) return { estado: 'NAO_ENCONTRADO', numero };
  return N.resumoPedido(o, cc.tel, cc.email);
}

// --------------------------------- IA ---------------------------------------
// imagens: [{ mime, base64 }] — fotos que o cliente mandou (a IA enxerga)
// Fotos das mensagens pendentes (até 2, jpeg/png/webp/gif, até ~3,5 MB cada)
async function imagensDasMensagens(msgs) {
  const out = [];
  for (const m of msgs) {
    if (out.length >= 2) break;
    if (!(m.midia_id || m.midia_url) || !/^image\/(jpeg|png|webp|gif)/.test(m.midia_mime || '') || m.tipo === 'sticker') continue;
    try { const { buf, mime } = await require('../lib/midia').baixarMidia(m); if (buf.length <= 3.5 * 1024 * 1024 && /^image\//.test(mime)) out.push({ mime, base64: buf.toString('base64') }); }
    catch (e) { await log(`Foto de ${m.wa_id} não baixada: ${e.message}`, 'aviso'); }
  }
  return out;
}

async function perguntarIA(prompt, imagens = []) {
  const content = imagens.length
    ? [...imagens.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.base64 } })), { type: 'text', text: `${prompt.usuario}\n\n(As imagens acima foram enviadas pelo cliente nesta conversa.)` }]
    : prompt.usuario;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODELO, max_tokens: 900, temperature: 0.6, system: prompt.sistema, messages: [{ role: 'user', content }] })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`IA ${r.status}: ${(j.error && j.error.message) || ''}`);
  return (j.content || []).map(b => b.text || '').join('');
}

// ------------------------------- Rodada -------------------------------------
async function enviarCanal(cfg, wa_id, texto) {
  if (DM.ehDM(wa_id)) return (await DM.enviarDM(wa_id, texto)).id;
  const r = await enviarTexto(cfg.phone_number_id, wa_id, texto);
  return (r.messages && r.messages[0] && r.messages[0].id) || `out_${Date.now()}`;
}
const modoDe = (cfg, wa_id) => DM.ehDM(wa_id) ? cfg.dm_modo : cfg.modo;
async function registrarSaida(cfg, wa_id, texto, categoria) {
  const agora = new Date().toISOString();
  const base = { wa_id, direcao: 'out', autor: 'ia', tipo: 'text', texto, categoria, criado_em: agora };
  if (modoDe(cfg, wa_id) !== 'automatico') {
    await sb('wa_mensagens', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ...base, id: `sim_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, status: 'simulada' }) });
    return 'simulada';
  }
  try {
    const id = await enviarCanal(cfg, wa_id, texto);
    await sb('wa_mensagens?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ ...base, id, status: 'enviada' }) });
    return 'enviada';
  } catch (e) {
    await sb('wa_mensagens', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ...base, id: `err_${Date.now()}`, status: 'erro', erro: e.message.slice(0, 300) }) });
    await log(`Envio para ${wa_id} falhou: ${e.message}`, 'erro');
    return 'erro';
  }
}

async function processar(wa_id) {
  const cfg = (await sb('wa_config?id=eq.1&select=*'))[0];
  if (!cfg || !(DM.ehDM(wa_id) ? cfg.dm_ativo : cfg.ativo)) return;
  const modo = modoDe(cfg, wa_id); const canal = DM.canalDe(wa_id);
  const cupomCfg = (await sb('meta_config?id=eq.1&select=cupom_codigo,cupom_desconto,cupom_validade').catch(() => [{}]))[0] || {};
  const cupomVig = cupomVigente(cupomCfg);

  for (let volta = 0; volta < 3; volta++) {
    const conv = (await sb(`wa_conversas?wa_id=eq.${encodeURIComponent(wa_id)}&select=*`))[0];
    if (!conv) return;
    const pendentes = await sb(`wa_mensagens?wa_id=eq.${encodeURIComponent(wa_id)}&direcao=eq.in&status=eq.recebida&order=criado_em.asc`);
    if (!pendentes.length) return;

    // Equipe no comando?
    if (conv.modo === 'humano') {
      const ultEquipe = (await sb(`wa_mensagens?wa_id=eq.${encodeURIComponent(wa_id)}&direcao=eq.out&autor=in.(equipe,equipe_app)&select=criado_em&order=criado_em.desc&limit=1`))[0];
      const ref = new Date((ultEquipe && ultEquipe.criado_em) || conv.humano_desde || 0).getTime();
      if (Date.now() - ref < cfg.horas_pausa_humano * 3600 * 1000) return; // equipe atende; IA quieta
      await sb(`wa_conversas?wa_id=eq.${encodeURIComponent(wa_id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ modo: 'ia', motivo_humano: null, humano_desde: null }) });
      await log(`Conversa ${wa_id} voltou para a IA (equipe sem responder há ${cfg.horas_pausa_humano}h).`);
    }

    const ultima = pendentes[pendentes.length - 1];
    if (modo === 'automatico') await (DM.ehDM(wa_id) ? DM.digitando(wa_id) : lidoDigitando(cfg.phone_number_id, ultima.id));
    // Áudios: transcreve (se houver OPENAI_API_KEY) e grava o texto na mensagem
    const TR = require('../lib/transcricao');
    if (TR.disponivel()) {
      for (const m of pendentes.filter(x => (x.tipo === 'audio' || /^audio\//.test(x.midia_mime || '')) && (x.midia_id || x.midia_url) && !/^\[áudio transcrito\]/.test(x.texto || ''))) {
        try {
          const t = await TR.transcrever(await require('../lib/midia').baixarMidia(m));
          if (t) {
            m.texto = `[áudio transcrito] ${t}`;
            await sb(`wa_mensagens?id=eq.${encodeURIComponent(m.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ texto: m.texto.slice(0, 4000) }) });
          }
        } catch (e) { await log(`Transcrição de áudio (${wa_id}): ${e.message}`, 'aviso'); }
      }
    }
    const textoPend = pendentes.map(m => m.texto || '').join('\n');
    const historico = await sb(`wa_mensagens?wa_id=eq.${encodeURIComponent(wa_id)}&status=neq.erro&order=criado_em.desc&limit=30`);
    historico.reverse();

    // LGPD: cliente pede exclusão dos dados (palavra EXCLUIR, conforme a política publicada)
    if (pendentes.some(m => /^\s*excluir\s*[.!]?\s*$/i.test(m.texto || ''))) {
      const aviso = 'Pronto! Excluímos o histórico do seu atendimento com a Condux, conforme a LGPD. Se precisar de algo, é só chamar 💙';
      if (modo === 'automatico') { try { await enviarCanal(cfg, wa_id, aviso); } catch (e) { await log(`Aviso de exclusão para ${wa_id}: ${e.message}`, 'erro'); } }
      await sb(`wa_mensagens?wa_id=eq.${encodeURIComponent(wa_id)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      await sb(`wa_conversas?wa_id=eq.${encodeURIComponent(wa_id)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      await log(`Dados de atendimento excluídos a pedido do cliente (final ${String(wa_id).slice(-4)}).`);
      return;
    }

    let dec;
    if (W.pedeHumano(textoPend)) {
      dec = { categoria: 'outro', acao: 'transferir', resposta: W.msgTransferencia('pedido'), motivo: 'cliente pediu atendente' };
    } else {
      let pedidoTxt = null; let linkRastreio = null;
      const nums = W.pedidoDaConversa(historico, textoPend);
      if (nums.length) {
        try { const res = await consultarPedido(nums[0], wa_id, W.extrairEmails(historico.filter(m => m.direcao === 'in').map(m => m.texto || '').join('\n'))); pedidoTxt = W.blocoPedido(res); if (res && res.estado === 'VERIFICADO') linkRastreio = res.link_rastreio || null; }
        catch (e) { await log(`Consulta de pedido ${nums[0]}: ${e.message}`, 'erro'); pedidoTxt = `NAO_VERIFICADO: ${nums[0]} (sistema de pedidos indisponível agora)`; }
      }
      const recentesCliente = historico.filter(m => m.direcao === 'in').slice(-4).map(m => m.texto || '').join('\n');
      const catalogo = await CAT.carregarCatalogo(sb);
      const carrinhoAtual = Array.isArray(conv.carrinho) ? conv.carrinho : [];
      const busca = textoPend + '\n' + recentesCliente;
      const achadosP = CAT.buscarConversa(catalogo, [textoPend, ...historico.filter(m => m.direcao === 'in' && !pendentes.some(p => p.id === m.id)).slice(-3).reverse().map(m => m.texto || '')]);
      const catalogoTxt = CAT.blocoCatalogo(catalogo, busca, achadosP);
      const imagens = await imagensDasMensagens(pendentes);
      // Já comprou no site? (define o cupom de fechamento)
      let clienteTxt = null;
      if (C.precisaCliente(carrinhoAtual, historico.slice(-8).map(m => m.texto || '').join('\n'))) {
        try { clienteTxt = C.blocoCliente(await C.identificarCliente(N, sb, { telefone: DM.ehDM(wa_id) ? null : wa_id, emails: W.extrairEmails(historico.filter(m => m.direcao === 'in').map(m => m.texto || '').join('\n')), mesmoTelefone: W.mesmoTelefone })); }
        catch (e) { await log(`Identificar cliente (${wa_id}): ${e.message}`, 'aviso'); }
      }
      try {
        const r = await C.rodadaComCarrinho({
          W, catalogo, carrinhoAtual, cuponsOk: C.cuponsValidos(cupomVig),
          links: [linkRastreio, ...achadosP.map(p => p.url), ...carrinhoAtual.map(i => i.url)],
          perguntar: nota => perguntarIA(W.montarPromptWA(historico, cupomCfg, pedidoTxt, conv.nome, undefined, catalogoTxt, canal, { carrinho: C.blocoCarrinho(carrinhoAtual), cliente: clienteTxt, nota }), imagens)
        });
        dec = r.dec;
        if (r.mudou) await sb(`wa_conversas?wa_id=eq.${encodeURIComponent(wa_id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ carrinho: r.carrinho }) });
        if (dec.link_carrinho) await log(`Link de carrinho enviado para final ${String(wa_id).slice(-4)}: ${r.carrinho.length} item(ns), subtotal R$ ${C.subtotal(r.carrinho).toFixed(2)}`);
      }
      catch (e) { await log(`IA falhou (${wa_id}): ${e.message}`, 'erro'); dec = { categoria: 'outro', acao: 'transferir', resposta: '', motivo: 'ia_indisponivel' }; }
      if (dec.acao === 'transferir' && !dec.resposta) dec.resposta = W.msgTransferencia();
    }

    // Marca as mensagens do cliente como atendidas ANTES de enviar (evita duplicar se outra rodada entrar)
    await sb(`wa_mensagens?id=in.(${pendentes.map(m => encodeURIComponent(m.id)).join(',')})`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'respondida', categoria: dec.categoria }) });
    await registrarSaida(cfg, wa_id, dec.resposta, dec.categoria);
    const upd = { ultima_msg_em: new Date().toISOString() };
    if (dec.acao === 'transferir') Object.assign(upd, { modo: 'humano', humano_desde: new Date().toISOString(), motivo_humano: dec.resumo_equipe || dec.motivo || dec.categoria || 'transferido pela IA' });
    await sb(`wa_conversas?wa_id=eq.${encodeURIComponent(wa_id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(upd) });
    if (dec.acao === 'transferir') return;
  }
}

exports.handler = async (event) => {
  const wa_id = event && event.queryStringParameters && event.queryStringParameters.wa_id;
  if (!wa_id) return { statusCode: 400 };
  if (!waToken() || !process.env.ANTHROPIC_API_KEY) { await log('Faltam WA_TOKEN/META_TOKEN ou ANTHROPIC_API_KEY no Netlify.', 'erro'); return { statusCode: 200 }; }
  // Trava por conversa (expira em 2 min se algo travar)
  const exp = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const lock = await sb(`wa_conversas?wa_id=eq.${encodeURIComponent(wa_id)}&or=(processando_desde.is.null,processando_desde.lt."${exp}")`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ processando_desde: new Date().toISOString() })
  }).catch(() => []);
  if (!lock || !lock.length) return { statusCode: 200 }; // outra rodada já está cuidando (ela reprocessa o que chegar)
  try {
    await sleep(3500);  // junta mensagens em sequência ("oi" + "tudo bem?" + pergunta)
    await processar(wa_id);
  } catch (e) { await log(`Rodada ${wa_id}: ${e.message}`, 'erro'); }
  finally {
    await sb(`wa_conversas?wa_id=eq.${encodeURIComponent(wa_id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ processando_desde: null }) }).catch(() => {});
  }
  // Chegou mensagem enquanto a trava estava ativa? Dispara nova rodada.
  try {
    const resto = await sb(`wa_mensagens?wa_id=eq.${encodeURIComponent(wa_id)}&direcao=eq.in&status=eq.recebida&select=id&limit=1`);
    const conv = (await sb(`wa_conversas?wa_id=eq.${encodeURIComponent(wa_id)}&select=modo`))[0];
    if (resto.length && conv && conv.modo === 'ia' && !(event.queryStringParameters || {}).reentrada) {
      await fetch(`${process.env.URL || 'https://condux-atendimento.netlify.app'}/.netlify/functions/wa-responder-background?wa_id=${encodeURIComponent(wa_id)}&reentrada=1`, { headers: require('../lib/guarda').cabecalhoInterno() }).catch(() => {});
    }
  } catch (e) {}
  return { statusCode: 200 };
};

exports._interno = { consultarPedido, processar, perguntarIA };


// Só painel logado ou chamada interna (ver netlify/lib/guarda.js)
exports.handler = require('../lib/guarda').proteger(exports.handler);
