// auth.js — login do painel Condux.
// Incluir como PRIMEIRO script do <head> de toda página interna:
//   <script src="auth.js"></script>
// 1) Sem sessão → vai para login.html (e volta para a página depois).
// 2) Intercepta o fetch: toda chamada ao Supabase passa a usar o token do
//    usuário logado (em vez da chave pública), e toda chamada às funções do
//    Netlify leva o token no cabeçalho x-painel-token. Assim as páginas
//    existentes funcionam sem alteração.
(function () {
  var SB_URL = 'https://ilekppgaltsrwmnodqxw.supabase.co';
  var SB_PUB = 'sb_publishable_CHIZxHt21omg3SEOHfRu3g_DDnPj72G';
  var CHAVE = 'sb-ilekppgaltsrwmnodqxw-auth-token';

  function ler() { try { return JSON.parse(localStorage.getItem(CHAVE) || 'null'); } catch (e) { return null; } }
  function salvar(s) { try { localStorage.setItem(CHAVE, JSON.stringify(s)); } catch (e) {} }
  function sair(motivo) {
    try { localStorage.removeItem(CHAVE); } catch (e) {}
    var volta = location.pathname + location.search;
    location.replace('login.html?volta=' + encodeURIComponent(volta) + (motivo ? '&m=' + motivo : ''));
  }

  var sessao = ler();
  if (!sessao || !sessao.refresh_token) {
    document.documentElement.style.visibility = 'hidden';
    sair();
    // Impede o resto da página de rodar com a chave pública
    throw new Error('Login necessário');
  }

  var fetchOriginal = window.fetch.bind(window);
  var renovando = null;
  function renovar() {
    if (renovando) return renovando;
    renovando = fetchOriginal(SB_URL + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', headers: { apikey: SB_PUB, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: sessao.refresh_token })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        renovando = null;
        if (!x.ok || !x.j.access_token) { sair('expirou'); throw new Error('Sessão expirada'); }
        sessao = x.j; if (!sessao.expires_at) sessao.expires_at = Math.floor(Date.now() / 1000) + (x.j.expires_in || 3600);
        salvar(sessao); return sessao.access_token;
      }, function (e) { renovando = null; throw e; });
    return renovando;
  }
  function tokenValido() {
    var agora = Math.floor(Date.now() / 1000);
    if (sessao.access_token && sessao.expires_at && sessao.expires_at - agora > 60) return Promise.resolve(sessao.access_token);
    return renovar();
  }

  window.fetch = function (entrada, opcoes) {
    var url = typeof entrada === 'string' ? entrada : (entrada && entrada.url) || '';
    var ehSupabase = url.indexOf(SB_URL + '/rest/') === 0 || url.indexOf(SB_URL + '/storage/') === 0;
    var ehFuncao = url.indexOf('/.netlify/functions/') !== -1 && (url.charAt(0) === '/' || url.indexOf(location.origin) === 0);
    if (!ehSupabase && !ehFuncao) return fetchOriginal(entrada, opcoes);
    return tokenValido().then(function (tk) {
      var o = Object.assign({}, opcoes || {});
      var h = new Headers(o.headers || (typeof entrada !== 'string' && entrada.headers) || {});
      if (ehSupabase) { h.set('apikey', SB_PUB); h.set('Authorization', 'Bearer ' + tk); }
      else h.set('x-painel-token', tk);
      o.headers = h;
      return fetchOriginal(typeof entrada === 'string' ? entrada : url, o).then(function (r) {
        if (ehSupabase && r.status === 401) return renovar().then(function (tk2) { h.set('Authorization', 'Bearer ' + tk2); return fetchOriginal(url, o); });
        return r;
      });
    });
  };

  // Barra discreta com o usuário e botão Sair
  window.painelSair = function () {
    fetchOriginal(SB_URL + '/auth/v1/logout', { method: 'POST', headers: { apikey: SB_PUB, Authorization: 'Bearer ' + sessao.access_token } }).catch(function () {});
    try { localStorage.removeItem(CHAVE); } catch (e) {}
    location.replace('login.html');
  };
  document.addEventListener('DOMContentLoaded', function () {
    var email = sessao.user && sessao.user.email;
    var d = document.createElement('div');
    d.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:9999;font:12px system-ui,sans-serif;background:rgba(17,20,24,.85);color:#fff;padding:6px 10px;border-radius:999px;display:flex;gap:10px;align-items:center';
    d.innerHTML = '<span>' + (email ? String(email).replace(/[<>&"]/g, '') : 'logado') + '</span><a href="#" onclick="painelSair();return false" style="color:#9ecbff;text-decoration:none;font-weight:600">Sair</a>';
    document.body.appendChild(d);
  });
})();
