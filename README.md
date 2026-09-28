# Condux — Atendimento IA

IA de vendas da Condux (fios e cabos elétricos) no **WhatsApp**, **Direct do Instagram / Messenger** e **comentários do Instagram e Facebook**. A IA entende a obra, indica a bitola de uso comum, monta o carrinho e manda o link `conduxcabos.com.br/comprar/...`, e o cliente conclui a compra no checkout da Nuvemshop.

Foi adaptado do atendimento da Huxter, mas é um projeto **separado**: repositório, Netlify e Supabase próprios. Sem Bling/ERP.

| Peça | Onde |
|---|---|
| Código | `huxterads-maker/condux-atendimento` |
| Site/funções | Netlify `condux-atendimento` (time Seven) |
| Banco | Supabase `condux-atendimento` (`ilekppgaltsrwmnodqxw`, São Paulo) |
| Loja | Nuvemshop `conduxcabos.com.br` |

## Onde fica cada coisa

- `netlify/lib/marca.js` — **dados da Condux**: domínio, frete grátis (R$ 150), Pix, parcelas, horário, nome do atendente e cupons fixos. É o primeiro lugar a editar.
- `netlify/lib/meta-nucleo.js` — base de conhecimento (bitolas, segurança técnica, condições) e regras dos comentários.
- `netlify/lib/wa-nucleo.js` — regras do WhatsApp/Direct: necessidade → carrinho → link, pedidos, trocas e transferência.
- `netlify/lib/catalogo.js` — busca no catálogo por bitola ("2,5", "1.5mm"), uso ("chuveiro", "tomada") e cor.
- `netlify/lib/carrinho.js` — valida o carrinho no catálogo (código, cor, estoque) e gera o link.
- `supabase/001_estrutura.sql` — tabelas, RLS e funções (já aplicado).
- `testes/rodar.js` — testes sem rede (`npm test`).

**Fonte da verdade:** preço, cor, estoque, conteúdo de kit e especificação vêm **só** do catálogo da Nuvemshop, sincronizado a cada 2 h. Para a IA "aprender" algo de um produto, escreva na descrição dele na Nuvemshop.

## Travas de segurança

A IA não publica respostas que:
- tragam links fora de `conduxcabos.com.br`;
- digam "cobre puro" ou "aguenta X W";
- garantam dimensionamento de circuito;
- peçam dados de cartão.

Carrinho com código, cor ou estoque inválido não gera link. Nesses casos a IA corrige uma vez ou transfere para a equipe. Tudo começa em **simulação**: nada é enviado ao cliente até você ativar o modo automático no painel.

## Variáveis de ambiente (Netlify)

| Variável | Para quê |
|---|---|
| `SUPABASE_URL` | `https://ilekppgaltsrwmnodqxw.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | chave pública (login do painel) |
| `SUPABASE_SERVICE_KEY` | chave **secret/service_role** do projeto Condux (Supabase → Settings → API Keys) |
| `ANTHROPIC_API_KEY` | IA (Claude). Opcional: `ANTHROPIC_MODEL` |
| `META_TOKEN` | token do Usuário do Sistema da Condux no Business Manager (WhatsApp + Página + Instagram) |
| `META_APP_SECRET` | segredo do app da Meta (confere a assinatura do webhook) |
| `META_APP_ID`, `META_BUSINESS_ID`, `META_PAGE_ID`, `META_AD_ACCOUNT_ID` | IDs da Condux na Meta |
| `WA_VERIFY_TOKEN` | texto qualquer, igual ao colocado no webhook da Meta |
| `NUVEM_APP_ID`, `NUVEM_CLIENT_SECRET` | app "Condux IA" no Portal de Parceiros da Nuvemshop |
| `OPENAI_API_KEY` | opcional — transcrição de áudio |

Webhook da Meta (WhatsApp, Instagram e Página): `https://condux-atendimento.netlify.app/.netlify/functions/whatsapp-webhook`

Nuvemshop:
- Redirect: `https://condux-atendimento.netlify.app/nuvem-callback.html`
- Webhooks LGPD: `/.netlify/functions/nuvem-lgpd?tipo=store-redact`, `?tipo=customers-redact` e `?tipo=customers-data-request`

Política de privacidade (Meta/Nuvemshop): `https://condux-atendimento.netlify.app/privacidade-atendimento.html`

## Login do painel

É por link mágico no e-mail. Só entra quem está na tabela `painel_usuarios`.

No Supabase, vá em **Authentication → URL Configuration** e configure:
- Site URL: `https://condux-atendimento.netlify.app`
- Redirect URLs: `https://condux-atendimento.netlify.app/**`
