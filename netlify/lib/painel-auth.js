// Confere se a chamada veio de alguém logado no painel e autorizado
// (token do Supabase no cabeçalho x-painel-token, enviado pelo auth.js).
const SB_URL = process.env.SUPABASE_URL;
const SB_PUB = process.env.SUPABASE_PUBLISHABLE_KEY;

async function usuarioDoPainel(event) {
  const h = event.headers || {};
  const tk = h['x-painel-token'] || h['X-Painel-Token'];
  if (!tk) return null;
  try {
    const ok = await fetch(`${SB_URL}/rest/v1/rpc/painel_autorizado`, {
      method: 'POST', headers: { apikey: SB_PUB, Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' }, body: '{}'
    }).then(r => r.ok ? r.json() : false);
    if (ok !== true) return null;
    const u = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_PUB, Authorization: `Bearer ${tk}` } }).then(r => r.ok ? r.json() : null);
    return u && u.email ? u : null;
  } catch (e) { return null; }
}
module.exports = { usuarioDoPainel };
