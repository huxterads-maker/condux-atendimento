// Netlify Background Function: meta-comentarios-background.js (até 15 min)
// Disparada a cada 10 min por meta-comentarios-scheduled.js (ou manualmente
// abrindo /.netlify/functions/meta-comentarios-background).
//
// 1) Lê anúncios ATIVOS da conta de anúncios + posts recentes do Instagram e
//    do Facebook e captura os comentários (e respostas de clientes em threads).
// 2) Grava tudo em meta_comentarios (idempotente pelo id do comentário).
// 3) Para cada comentário novo: IA classifica e escreve a resposta.
//    - modo "simulacao": só grava a resposta sugerida (status = simulado).
//    - modo "automatico": publica a resposta (status = respondido).
// Travas: interruptor geral (ativo), limite de respostas por hora, janela de
// datas (responder_desde), nunca responde duas vezes, nunca responde a si
// mesmo, ignora ofensivo/conversa, oculta só spam claro, bloqueia texto com
// link/alegação de saúde/cupom vencido. Ver netlify/lib/meta-nucleo.js.
//
// Variáveis de ambiente (Netlify › Site configuration › Environment variables):
//   META_TOKEN          token de Usuário do Sistema (Business Manager) — obrigatório
//   META_AD_ACCOUNT_ID  ex.: act_1234567890 — para ler comentários de anúncios
//   META_PAGE_ID        opcional (se o token enxergar mais de uma Página)
//   ANTHROPIC_API_KEY   chave da API da Anthropic — obrigatório
//   ANTHROPIC_MODEL     opcional (padrão: claude-haiku-4-5-20251001)
//   META_API_VERSION    opcional (padrão: v23.0)

const N = require('../lib/meta-nucleo');
const CAT = require('../lib/catalogo');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const GV = process.env.META_API_VERSION || 'v23.0';
const G = `https://graph.facebook.com/${GV}`;
const MODELO = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const ORCAMENTO_MS = 13 * 60 * 1000;   // para antes dos 15 min da background
const MAX_IA_POR_RODADA = 80;
const POSTS_MAX = 60;                  // teto de posts orgânicos por rede (dentro da janela responder_desde)

// ------------------------------- Supabase ----------------------------------
const SBH = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' };
async function sb(path, opt = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...opt, headers: { ...SBH, ...(opt.headers || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`Supabase ${r.status} ${path.split('?')[0]}: ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}
const log = (msg, nivel = 'info') => sb('meta_log', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ msg: String(msg).slice(0, 2000), nivel }) }).catch(() => {});

// --------------------------------- Meta ------------------------------------
async function gget(path, token, params = {}) {
  const u = new URL(path.startsWith('http') ? path : `${G}/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  if (!u.searchParams.has('access_token')) u.searchParams.set('access_token', token);
  const r = await fetch(u);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`Graph ${path.split('?')[0]}: ${(j.error && j.error.message) || r.status}`);
  return j;
}
async function gpost(path, token, params = {}) {
  const body = new URLSearchParams({ ...params, access_token: token });
  const r = await fetch(`${G}/${path}`, { method: 'POST', body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`Graph POST ${path}: ${(j.error && j.error.message) || r.status}`);
  return j;
}
async function todas(path, token, params, limite = 200) {
  const out = []; let j = await gget(path, token, params);
  while (j) {
    out.push(...(j.data || []));
    if (out.length >= limite || !j.paging || !j.paging.next) break;
    j = await gget(j.paging.next, token);
  }
  return out;
}

async function descobrirContas(token) {
  const pags = await todas('me/accounts', token, { fields: 'id,name,access_token,instagram_business_account{id,username}', limit: '50' });
  if (!pags.length) throw new Error('O token não enxerga nenhuma Página. Atribua a Página da Condux ao Usuário do Sistema.');
  const p = process.env.META_PAGE_ID ? pags.find(x => x.id === process.env.META_PAGE_ID) : (pags.find(x => /condux/i.test(x.name)) || pags[0]);
  if (!p) throw new Error('META_PAGE_ID não encontrado entre as Páginas do token.');
  const ig = p.instagram_business_account || null;
  return { pageId: p.id, pageNome: p.name, pageToken: p.access_token, igId: ig && ig.id, igUser: ig && ig.username };
}

// Monta a lista de "objetos com comentários": mídias do IG e posts do FB,
// vindos dos anúncios ativos e dos posts orgânicos recentes.
// "Cabo 2,5mm 2026-09-14-96ccd9ad…" → "Cabo 2,5mm"
function limparNome(n) {
  return String(n || '').replace(/\s*\d{4}-\d{2}-\d{2}-[0-9a-f]{8,}.*$/i, '').replace(/\s*\(vers[aã]o\)\s*$/i, '').trim();
}

async function listarAlvos(token, c, desde, rapido) {
  const maxPosts = rapido === 'historico' ? 400 : rapido ? 8 : POSTS_MAX;
  if (rapido === true) desde = new Date(Math.max(desde.getTime(), Date.now() - 3 * 864e5)); // rápido: só posts dos últimos 3 dias
  const alvos = new Map(); // chave: plataforma:id
  const add = (plataforma, id, extra) => { if (id && !alvos.has(`${plataforma}:${id}`)) alvos.set(`${plataforma}:${id}`, { plataforma, id, ...extra }); };
  const diag = [];

  if (process.env.META_AD_ACCOUNT_ID) {
    const act = process.env.META_AD_ACCOUNT_ID.startsWith('act_') ? process.env.META_AD_ACCOUNT_ID : `act_${process.env.META_AD_ACCOUNT_ID}`;
    try {
      const ads = await todas(`${act}/ads`, token, {
        fields: 'id,name,effective_status,creative{effective_instagram_media_id,source_instagram_media_id,effective_object_story_id,body,title}',
        effective_status: ['ACTIVE'], limit: '100'
      }, 300);
      let ig = 0, fb = 0;
      for (const ad of ads) {
        const cr = ad.creative || {};
        const leg = [cr.title, cr.body].filter(Boolean).join(' — ');
        const igMedia = cr.effective_instagram_media_id || cr.source_instagram_media_id; // post turbinado usa source_
        if (igMedia) ig++; if (cr.effective_object_story_id) fb++;
        add('instagram', igMedia, { origem: 'anuncio', anuncio_id: ad.id, anuncio_nome: ad.name, legenda: leg });
        add('facebook', cr.effective_object_story_id, { origem: 'anuncio', anuncio_id: ad.id, anuncio_nome: ad.name, legenda: leg });
      }
      diag.push(`anúncios ativos ${ads.length} (com mídia IG ${ig}, com post FB ${fb})`);

      // Anúncio com VÁRIAS versões (formato flexível / várias imagens): cada versão
      // vira um post próprio no Instagram e no Facebook, mas a Meta só aponta uma
      // em effective_instagram_media_id. Lemos todos os criativos de cada anúncio.
      let variacoes = 0;
      for (const ad of ads) {
        try {
          const crs = await todas(`${ad.id}/adcreatives`, token, { fields: 'id,effective_instagram_media_id,source_instagram_media_id,effective_object_story_id,body,title', limit: '50' }, 50);
          for (const cr of crs) {
            const leg = [cr.title, cr.body].filter(Boolean).join(' — ');
            const antes = alvos.size;
            add('instagram', cr.effective_instagram_media_id || cr.source_instagram_media_id, { origem: 'anuncio', anuncio_id: ad.id, anuncio_nome: ad.name, legenda: leg });
            add('facebook', cr.effective_object_story_id, { origem: 'anuncio', anuncio_id: ad.id, anuncio_nome: ad.name, legenda: leg });
            variacoes += alvos.size - antes;
          }
        } catch (e) { /* segue com a mídia principal */ }
      }
      // Rodada completa: varre também os criativos recentes da conta (versões que
      // não aparecem ligadas ao anúncio, ex.: formato flexível gerado pela Meta).
      if (!rapido) {
        try {
          const crs = await todas(`${act}/adcreatives`, token, { fields: 'id,name,effective_instagram_media_id,effective_object_story_id,body,title', limit: '50' }, 60);
          for (const cr of crs) {
            const leg = [cr.title, cr.body].filter(Boolean).join(' — ');
            const antes = alvos.size;
            const nome = limparNome(cr.name) || 'Anúncio';
            add('instagram', cr.effective_instagram_media_id, { origem: 'anuncio', anuncio_nome: nome, legenda: leg });
            add('facebook', cr.effective_object_story_id, { origem: 'anuncio', anuncio_nome: nome, legenda: leg });
            variacoes += alvos.size - antes;
          }
        } catch (e) { await log(`Falha ao ler criativos da conta: ${e.message}`, 'erro'); }
      }
      diag.push(`versões extras de anúncios ${variacoes}`);
    } catch (e) { await log(`Falha ao ler anúncios (${e.message}). Seguindo só com posts orgânicos.`, 'erro'); }
  }
  // Posts orgânicos (inclui posts turbinados pelo app): pagina até sair da janela
  if (c.igId) {
    try {
      let j = await gget(`${c.igId}/media`, c.pageToken, { fields: 'id,caption,permalink,timestamp,comments_count', limit: '25' });
      let n = 0, com = 0;
      pag: while (j) {
        for (const m of j.data || []) {
          if (n >= maxPosts || (m.timestamp && new Date(m.timestamp) < desde)) break pag;
          n++; if (m.comments_count) { com++; add('instagram', m.id, { origem: 'post', legenda: m.caption, permalink: m.permalink }); }
        }
        j = j.paging && j.paging.next ? await gget(j.paging.next, c.pageToken) : null;
      }
      diag.push(`posts IG ${n} (com comentários ${com})`);
    } catch (e) { await log(`Falha ao ler posts do Instagram: ${e.message}`, 'erro'); }
  }
  try {
    let j = await gget(`${c.pageId}/posts`, c.pageToken, { fields: 'id,message,permalink_url,created_time', limit: '25' });
    let n = 0;
    pag: while (j) {
      for (const p of j.data || []) {
        if (n >= maxPosts || (p.created_time && new Date(p.created_time) < desde)) break pag;
        n++; add('facebook', p.id, { origem: 'post', legenda: p.message, permalink: p.permalink_url });
      }
      j = j.paging && j.paging.next ? await gget(j.paging.next, c.pageToken) : null;
    }
    diag.push(`posts FB ${n}`);
  } catch (e) { await log(`Falha ao ler posts do Facebook: ${e.message}`, 'erro'); }
  if (!rapido) await log(`Alvos: ${diag.join(' · ')} · total a ler ${alvos.size}`);
  return [...alvos.values()];
}

// Normaliza comentários (e respostas de clientes dentro das threads).
async function lerComentarios(alvo, c) {
  let diagMeta = null;
  const out = []; const respostasMarca = [];
  if (alvo.plataforma === 'instagram') {
    let meta = {};
    diagMeta = meta;
    if (!alvo.legenda || !alvo.permalink || alvo.origem === 'anuncio') meta = await gget(alvo.id, c.pageToken, { fields: 'caption,permalink,comments_count' }).catch(e => ({ _erro: e.message }));
    diagMeta = meta;
    const legenda = alvo.legenda || meta.caption; const permalink = alvo.permalink || meta.permalink;
    const coms = await todas(`${alvo.id}/comments`, c.pageToken, { fields: 'id,text,username,timestamp,replies{id,text,username,timestamp}', limit: '50' }, 300);
    for (const k of coms) {
      const reps = (k.replies && k.replies.data) || [];
      const daMarca = reps.filter(r => c.igUser && r.username && r.username.toLowerCase() === c.igUser.toLowerCase());
      daMarca.forEach(r => respostasMarca.push(r.text));
      const ultMarca = daMarca.reduce((m, r) => (r.timestamp > m ? r.timestamp : m), '');
      const ultTxtIg = daMarca.filter(r => r.timestamp === ultMarca).map(r => r.text)[0] || null;
      out.push({ id: k.id, plataforma: 'instagram', autor: k.username, texto: k.text, criado_em: k.timestamp, jaRespondidoPelaMarca: daMarca.length > 0, respostaMarca: ultTxtIg, legenda, permalink });
      // Cliente respondeu DENTRO da thread depois da última resposta da marca
      // (ex.: "e tem G?"). Sem resposta da marca, a thread é atendida pelo
      // comentário principal — não respondemos cada réplica separadamente.
      if (ultMarca) for (const r of reps) {
        if (daMarca.includes(r) || !(r.timestamp > ultMarca)) continue;
        out.push({ id: r.id, pai_id: k.id, plataforma: 'instagram', autor: r.username, texto: r.text, criado_em: r.timestamp, jaRespondidoPelaMarca: false, legenda, permalink });
      }
    }
  } else {
    let meta = {};
    if (!alvo.legenda || !alvo.permalink) meta = await gget(alvo.id, c.pageToken, { fields: 'message,permalink_url' }).catch(() => ({}));
    const legenda = alvo.legenda || meta.message; const permalink = alvo.permalink || meta.permalink_url;
    const coms = await todas(`${alvo.id}/comments`, c.pageToken, { fields: 'id,message,from{id,name},created_time,comments.limit(25){id,message,from{id,name},created_time}', filter: 'toplevel', order: 'reverse_chronological', limit: '50' }, 300);
    for (const k of coms) {
      const reps = (k.comments && k.comments.data) || [];
      const daMarca = reps.filter(r => r.from && r.from.id === c.pageId);
      daMarca.forEach(r => respostasMarca.push(r.message));
      const ultMarca = daMarca.reduce((m, r) => (r.created_time > m ? r.created_time : m), '');
      if (k.from && k.from.id === c.pageId) continue;
      const ultTxtFb = daMarca.filter(r => r.created_time === ultMarca).map(r => r.message)[0] || null;
      out.push({ id: k.id, plataforma: 'facebook', autor: k.from && k.from.name, texto: k.message, criado_em: k.created_time, jaRespondidoPelaMarca: daMarca.length > 0, respostaMarca: ultTxtFb, legenda, permalink });
      for (const r of reps) {
        if (daMarca.includes(r)) continue;
        if (ultMarca && r.created_time > ultMarca) out.push({ id: r.id, pai_id: k.id, plataforma: 'facebook', autor: r.from && r.from.name, texto: r.message, criado_em: r.created_time, jaRespondidoPelaMarca: false, legenda, permalink });
      }
    }
  }
  return { comentarios: out.map(x => ({ ...x, origem: alvo.origem, midia_id: alvo.id, anuncio_id: alvo.anuncio_id || null, anuncio_nome: alvo.anuncio_nome || null })), respostasMarca, diag: diagMeta };
}

// --------------------------------- IA ---------------------------------------
async function perguntarIA(prompt) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODELO, max_tokens: 400, temperature: 0.7, system: prompt.sistema, messages: [{ role: 'user', content: prompt.usuario }] })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`IA ${r.status}: ${(j.error && j.error.message) || ''}`);
  return (j.content || []).map(b => b.text || '').join('');
}

// ------------------------------- Publicar -----------------------------------
async function publicar(row, c) {
  const alvo = row.pai_id || row.id; // IG/FB: respostas em thread vão no comentário-pai
  if (row.plataforma === 'instagram') return gpost(`${alvo}/replies`, c.pageToken, { message: row.resposta });
  return gpost(`${alvo}/comments`, c.pageToken, { message: row.resposta });
}
async function ocultar(row, c) {
  if (row.plataforma === 'instagram') return gpost(row.id, c.pageToken, { hide: 'true' });
  return gpost(row.id, c.pageToken, { is_hidden: 'true' });
}

// -------------------------------- Rodada ------------------------------------
exports.handler = async (event) => {
  const t0 = Date.now();
  // rapido=1: rodada leve a cada minuto (anúncios ativos + posts dos últimos 3 dias).
  // A rodada completa (a cada 10 min) varre a janela inteira e grava o diagnóstico.
  const rapido = !!(event && event.queryStringParameters && event.queryStringParameters.rapido === '1');
  // autor=usuario: busca HISTÓRICA — varre até 400 posts (sem limite de data) só
  // atrás dos comentários desse autor e responde mesmo fora da janela.
  const qs = (event && event.queryStringParameters) || {};
  const autorAlvo = qs.autor ? String(qs.autor).replace(/^@/, '').trim().toLowerCase() : null;
  const orcamento = rapido ? 50 * 1000 : ORCAMENTO_MS;
  const maxIA = rapido ? 15 : MAX_IA_POR_RODADA;
  const resumo = { capturados: 0, novos: 0, ia: 0, respondidos: 0, simulados: 0, ignorados: 0, ocultados: 0, erros: 0 };

  if (!process.env.META_TOKEN || !process.env.ANTHROPIC_API_KEY) {
    await log('Faltam variáveis de ambiente META_TOKEN e/ou ANTHROPIC_API_KEY no Netlify.', 'erro');
    return { statusCode: 200 };
  }
  // Trava contra rodadas sobrepostas (condicional atômica no PATCH)
  const agoraIso = new Date().toISOString();
  const expira = new Date(Date.now() - 14 * 60 * 1000).toISOString();
  const lock = await sb(`meta_config?id=eq.1&or=(rodando_desde.is.null,rodando_desde.lt."${expira}")`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ rodando_desde: agoraIso })
  }).catch(async e => { await log(e.message, 'erro'); return []; });
  if (!lock || !lock.length) return { statusCode: 200 };
  let cfg = lock[0];

  try {
    if (!cfg.ativo) { resumo.obs = 'desligado'; return { statusCode: 200 }; }
    const c = await descobrirContas(process.env.META_TOKEN);

    // 1) Captura
    const alvos = autorAlvo
      ? await listarAlvos(process.env.META_TOKEN, c, new Date(0), 'historico')
      // Posts dos últimos 60 dias (comentário novo chega em post antigo); a janela
      // responder_desde continua valendo para o COMENTÁRIO (precisaProcessar).
      : await listarAlvos(process.env.META_TOKEN, c, new Date(Math.min(new Date(cfg.responder_desde).getTime(), Date.now() - 60 * 864e5)), rapido);
    const contexto = new Map();
    const porAnuncio = [];
    for (const alvo of alvos) {
      if (Date.now() - t0 > orcamento / 2) break;
      let res;
      try { res = await lerComentarios(alvo, c); } catch (e) { resumo.erros++; await log(`Comentários de ${alvo.plataforma} ${alvo.id}: ${e.message}`, 'erro'); continue; }
      if (autorAlvo) res.comentarios = res.comentarios.filter(k => String(k.autor || '').toLowerCase() === autorAlvo).map(k => ({ ...k, ignorarJanela: true }));
      resumo.capturados += res.comentarios.length;
      if (alvo.origem === 'anuncio') {
        const d = res.diag || {};
        const extra = alvo.plataforma === 'instagram' ? ` (mídia ${alvo.id}${d.comments_count != null ? `, a Meta conta ${d.comments_count}` : ''}${d.permalink ? `, ${d.permalink}` : ''}${d._erro ? `, erro: ${d._erro}` : ''})` : '';
        if (res.comentarios.length || d.comments_count) porAnuncio.push(`${alvo.plataforma === 'instagram' ? 'IG' : 'FB'} "${alvo.anuncio_nome}": ${res.comentarios.length}${extra}`);
      }
      contexto.set(alvo.id, res.respostasMarca);
      if (!res.comentarios.length) continue;
      const ids = res.comentarios.map(x => x.id);
      const existentes = new Set();
      for (let i = 0; i < ids.length; i += 100) {
        const lote = ids.slice(i, i + 100).map(encodeURIComponent).join(',');
        (await sb(`meta_comentarios?select=id&id=in.(${lote})`)).forEach(r => existentes.add(r.id));
      }
      // A equipe respondeu manualmente um comentário que já estava no banco (na fila ou simulado)?
      // Marca como já respondido para o automático nunca responder de novo.
      for (const k of res.comentarios) {
        if (!existentes.has(k.id) || !k.jaRespondidoPelaMarca) continue;
        await sb(`meta_comentarios?id=eq.${encodeURIComponent(k.id)}&status=in.(novo,simulado,ignorado,fora_janela,erro,ja_respondido)&or=(status.neq.ja_respondido,resposta.is.null)`, {
          method: 'PATCH', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ status: 'ja_respondido', motivo: 'equipe', resposta: k.respostaMarca || null, atualizado_em: new Date().toISOString() })
        }).catch(() => {});
      }
      const novos = [];
      for (const k of res.comentarios) {
        const d = N.precisaProcessar(k, existentes.has(k.id), cfg, c.igUser);
        if (d.status === null || d.status === 'proprio') continue;
        novos.push({
          id: k.id, pai_id: k.pai_id || null, plataforma: k.plataforma, origem: k.origem, midia_id: k.midia_id,
          anuncio_id: k.anuncio_id, anuncio_nome: k.anuncio_nome, permalink: k.permalink, autor: k.autor, texto: k.texto,
          criado_em: k.criado_em, contexto: k.legenda ? String(k.legenda).slice(0, 1500) : null,
          status: d.ok ? 'novo' : d.status,
          resposta: d.status === 'ja_respondido' ? (k.respostaMarca || null) : null,
          motivo: d.status === 'ja_respondido' ? 'equipe' : null
        });
      }
      if (novos.length) {
        await sb('meta_comentarios?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(novos) });
        resumo.novos += novos.length;
      }
    }

    if (porAnuncio.length && !rapido) await log(`Comentários por anúncio: ${porAnuncio.join(' · ')}`);

    // 2) Fila: novos (e, no automático, simulados ainda não publicados dentro da janela responder_desde)
    const desdeJanela = new Date(cfg.responder_desde).toISOString();
    let fila = await sb(`meta_comentarios?select=*&status=eq.novo&tentativas=lt.3&order=criado_em.desc&limit=${maxIA}`);
    if (cfg.modo === 'automatico') {
      const sim = await sb(`meta_comentarios?select=*&status=eq.simulado&acao=in.(responder,ocultar)&criado_em=gte.${desdeJanela}&order=criado_em.asc&limit=40`);
      fila = sim.concat(fila);
    }
    const umaHora = new Date(Date.now() - 3600 * 1000).toISOString();
    let naHora = (await sb(`meta_comentarios?select=id&status=eq.respondido&respondido_em=gte.${umaHora}`)).length;

    for (const row of fila) {
      if (Date.now() - t0 > orcamento) break;
      // Rechecar interruptor a cada item (desligar no painel para na hora)
      if (resumo.ia % 10 === 0) { cfg = (await sb('meta_config?id=eq.1&select=*'))[0]; if (!cfg.ativo) break; }
      try {
        let dec;
        if (row.status === 'simulado' && row.acao === 'ocultar') {
          dec = { categoria: row.categoria, acao: 'ocultar', resposta: '' };
        } else if (row.status === 'simulado' && row.resposta) {
          dec = { categoria: row.categoria, acao: 'responder', resposta: row.resposta };
          const m = N.checarResposta(dec.resposta, cfg); if (m) dec = { ...dec, acao: 'ignorar', motivo: m };
        } else {
          const catalogoTxt = CAT.blocoCatalogo(await CAT.carregarCatalogo(sb), `${row.texto || ''}\n${row.anuncio_nome || ''}\n${(row.contexto || '').slice(0, 300)}`);
          const prompt = N.montarPrompt(row, { legenda: row.contexto, catalogo: catalogoTxt, respostasAnteriores: contexto.get(row.midia_id) || [] }, cfg);
          dec = N.interpretar(await perguntarIA(prompt), cfg);
          resumo.ia++;
        }
        const upd = { categoria: dec.categoria, acao: dec.acao, resposta: dec.resposta || null, motivo: dec.motivo || null, atualizado_em: new Date().toISOString(), erro: null };

        if (dec.acao === 'responder') {
          if (cfg.modo !== 'automatico') { upd.status = 'simulado'; resumo.simulados++; }
          else if (naHora >= cfg.limite_por_hora) { upd.status = 'simulado'; upd.motivo = 'limite_por_hora'; resumo.simulados++; }
          else {
            const p = await publicar({ ...row, resposta: dec.resposta }, c);
            upd.status = 'respondido'; upd.respondido_em = new Date().toISOString(); upd.resposta_id = p.id || null;
            naHora++; resumo.respondidos++;
            (contexto.get(row.midia_id) || contexto.set(row.midia_id, []).get(row.midia_id)).push(dec.resposta);
          }
        } else if (dec.acao === 'ocultar') {
          if (cfg.modo === 'automatico') { await ocultar(row, c); upd.status = 'ocultado'; resumo.ocultados++; }
          else { upd.status = 'simulado'; resumo.simulados++; }
        } else { upd.status = 'ignorado'; resumo.ignorados++; }

        await sb(`meta_comentarios?id=eq.${encodeURIComponent(row.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(upd) });
      } catch (e) {
        resumo.erros++;
        await sb(`meta_comentarios?id=eq.${encodeURIComponent(row.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: (row.tentativas || 0) + 1 >= 3 ? 'erro' : row.status, tentativas: (row.tentativas || 0) + 1, erro: e.message.slice(0, 500), atualizado_em: new Date().toISOString() }) }).catch(() => {});
        if (/rate|limit|too many/i.test(e.message)) { await log(`Limite de API atingido: ${e.message}`, 'erro'); break; }
      }
    }
  } catch (e) {
    resumo.erros++; resumo.obs = e.message;
    await log(`Rodada falhou: ${e.message}`, 'erro');
  } finally {
    const txt = `${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} · ${rapido ? 'rápida' : 'completa'} · ${cfg.modo} · capturados ${resumo.capturados}, novos ${resumo.novos}, IA ${resumo.ia}, respondidos ${resumo.respondidos}, simulados ${resumo.simulados}, ignorados ${resumo.ignorados}, ocultados ${resumo.ocultados}, erros ${resumo.erros}${resumo.obs ? ' · ' + resumo.obs : ''}`;
    // Rodada rápida sem novidade não polui o registro (roda 1.440x por dia)
    const houveAlgo = !rapido || resumo.novos || resumo.ia || resumo.respondidos || resumo.ocultados || resumo.erros || (resumo.obs && resumo.obs !== 'desligado');
    const fim = { rodando_desde: null, ultima_execucao: new Date().toISOString() };
    if (houveAlgo) fim.ultimo_resumo = txt;
    await sb('meta_config?id=eq.1', { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(fim) }).catch(() => {});
    if (houveAlgo) await log(txt);
  }
  return { statusCode: 200 };
};

// Exporta para testes
exports._interno = { lerComentarios, listarAlvos, descobrirContas };


// Só painel logado ou chamada interna (ver netlify/lib/guarda.js)
exports.handler = require('../lib/guarda').proteger(exports.handler);
