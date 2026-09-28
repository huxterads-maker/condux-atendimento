// Configuração da marca e do ambiente — ÚNICO lugar com dados da Condux.
// Tudo o que a IA afirma sobre a empresa sai daqui (BASE em meta-nucleo.js)
// e do catálogo da Nuvemshop (preço, estoque, variações, descrição).
//
// Nenhum valor padrão aponta para outro projeto: sem SUPABASE_URL /
// SUPABASE_SERVICE_KEY no Netlify, as funções param com erro claro.

const obrigatoria = nome => {
  const v = process.env[nome];
  if (!v) throw new Error(`Variável ${nome} não configurada no Netlify.`);
  return v;
};

const MARCA = {
  nome: 'Condux',
  razao_social: 'CONDUX E-COMMERCE LTDA',
  cnpj: '65.639.175/0001-99',
  // Domínio principal da loja Nuvemshop (os links de produto e de carrinho usam este)
  loja: 'https://conduxcabos.com.br',
  // Hosts aceitos em links que a IA escrever (qualquer outro é bloqueado)
  hosts: ['conduxcabos.com.br', 'www.conduxcabos.com.br', 'promo.conduxcabos.com.br'],
  // Páginas fixas do site que a IA pode indicar
  paginas: {
    trocas: 'https://conduxcabos.com.br/trocas-e-devolucoes/',
    faq: 'https://conduxcabos.com.br/perguntas-frequentes/',
    como_comprar: 'https://conduxcabos.com.br/como-comprar/',
    bitolas: 'https://conduxcabos.com.br/cabos-por-bitola/',
    quem_somos: 'https://conduxcabos.com.br/quem-somos/'
  },
  email: 'contato@conduxcabos.com.br',
  whatsapp: '(11) 99422-1228',
  user_agent: 'Condux IA (contato@conduxcabos.com.br)',
  // Condições comerciais do site (conferir com a Nuvemshop se mudar)
  frete_gratis_acima: 150,          // R$ — valor exibido na loja em 27/09/2026
  pix_desconto: '10%',
  parcelas: 10,
  // Atendimento humano
  atendente: null,                  // ex.: 'Daniel' — sem nome, a IA diz "nossa equipe"
  horario: { dias: [1, 2, 3, 4, 5], ini: 9, fim: 18, texto: 'segunda a sexta, das 9h às 18h' },
  // Cupons fixos (além do cupom de campanha configurado no painel). null = não oferecer.
  cupom_primeira_compra: null,      // ex.: { codigo: 'PRIMEIRACOMPRA', desconto: '5%' }
  cupom_recompra: null              // ex.: { codigo: 'VOLTEI10', desconto: '10%' }
};

const quemAtende = () => MARCA.atendente ? MARCA.atendente : 'nossa equipe';

function ambiente() {
  const SB_URL = obrigatoria('SUPABASE_URL');
  const SB_KEY = obrigatoria('SUPABASE_SERVICE_KEY');
  return { SB_URL, SB_KEY, SITE: process.env.URL || '' };
}

// Cliente REST do Supabase com a chave de serviço (só no servidor)
function criarSb() {
  const { SB_URL, SB_KEY } = ambiente();
  const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' };
  return async function sb(path, opt = {}) {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...opt, headers: { ...H, ...(opt.headers || {}) } });
    const t = await r.text();
    if (!r.ok) throw new Error(`Supabase ${r.status} ${String(path).split('?')[0]}: ${t.slice(0, 200)}`);
    return t ? JSON.parse(t) : null;
  };
}

module.exports = { MARCA, quemAtende, ambiente, criarSb, obrigatoria };
