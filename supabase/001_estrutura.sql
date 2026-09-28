-- Condux Atendimento IA — estrutura inicial (WhatsApp, Direct, comentários, catálogo Nuvemshop)
-- Sem Bling/ERP. RLS em todas as tabelas: o painel (usuário logado e cadastrado em
-- painel_usuarios) acessa; as funções do Netlify usam a chave de serviço.

create table public.painel_usuarios (
  email text primary key, nome text, criado_em timestamptz default now()
);

create or replace function public.painel_autorizado() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.painel_usuarios where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

create table public.wa_config (
  id int primary key default 1 check (id = 1),
  ativo boolean not null default true,
  modo text not null default 'simulacao' check (modo in ('simulacao','automatico')),
  phone_number_id text, waba_id text, numero_exibicao text,
  horas_pausa_humano int not null default 12,
  dm_ativo boolean not null default true,
  dm_modo text not null default 'simulacao' check (dm_modo in ('simulacao','automatico')),
  pin_2fa text, atualizado_em timestamptz default now()
);

create table public.wa_conversas (
  wa_id text primary key, nome text,
  modo text not null default 'ia' check (modo in ('ia','humano')),
  humano_desde timestamptz, motivo_humano text,
  ultima_msg_em timestamptz, ultima_cliente_em timestamptz,
  nao_lidas int not null default 0, processando_desde timestamptz,
  criado_em timestamptz default now(),
  canal text not null default 'whatsapp', usuario text, carrinho jsonb
);
create index wa_conv_ult_idx on public.wa_conversas (ultima_msg_em desc);
create index wa_conversas_canal_idx on public.wa_conversas (canal, ultima_msg_em desc);

create table public.wa_mensagens (
  id text primary key,
  wa_id text not null references public.wa_conversas(wa_id) on delete cascade,
  direcao text not null check (direcao in ('in','out')),
  autor text not null, tipo text default 'text', texto text, status text, categoria text, erro text,
  criado_em timestamptz default now(), midia_id text, midia_url text, midia_mime text
);
create index wa_msg_conv_idx on public.wa_mensagens (wa_id, criado_em);

create table public.wa_log (id bigserial primary key, em timestamptz default now(), nivel text default 'info', msg text);

create or replace function public.wa_incrementa_nao_lidas(p_wa_id text) returns void
language sql set search_path to 'public' as $$
  update public.wa_conversas set nao_lidas = nao_lidas + 1 where wa_id = p_wa_id;
$$;

create table public.meta_config (
  id int primary key default 1 check (id = 1),
  ativo boolean not null default true,
  modo text not null default 'simulacao' check (modo in ('simulacao','automatico')),
  cupom_codigo text, cupom_desconto text, cupom_validade date,
  limite_por_hora int not null default 40,
  responder_desde timestamptz not null default now(),
  ocultar_spam boolean not null default true,
  rodando_desde timestamptz, ultima_execucao timestamptz, ultimo_resumo text,
  atualizado_em timestamptz default now()
);

create table public.meta_comentarios (
  id text primary key,
  plataforma text not null check (plataforma in ('instagram','facebook')),
  origem text, midia_id text, anuncio_id text, anuncio_nome text, permalink text,
  autor text, texto text, criado_em timestamptz, categoria text, acao text, resposta text,
  status text not null default 'novo', erro text, respondido_em timestamptz, resposta_id text,
  capturado_em timestamptz default now(), atualizado_em timestamptz default now(),
  pai_id text, contexto text, tentativas int not null default 0, motivo text
);
create index meta_comentarios_status_idx on public.meta_comentarios (status);
create index meta_comentarios_criado_idx on public.meta_comentarios (criado_em desc);

create table public.meta_log (id bigserial primary key, em timestamptz default now(), nivel text default 'info', msg text);

create table public.catalogo (
  url text primary key, produto_id bigint, nome text, categoria text, marca text, tags text[],
  preco numeric, preco_de numeric, disponivel boolean, estoque_total int, variantes jsonb,
  descricao text, imagem text, ativo boolean not null default true,
  atualizado_em timestamptz default now(), fonte text default 'api'
);
create index catalogo_ativo_idx on public.catalogo (ativo);

create table public.nuvem_tokens (
  id int primary key default 1 check (id = 1),
  store_id text not null, access_token text not null, scope text, conectado_por text,
  atualizado_em timestamptz not null default now()
);

create table public.nuvem_clientes_tel (
  hash text primary key, comprou boolean not null default false, atualizado_em timestamptz not null default now()
);
comment on table public.nuvem_clientes_tel is 'Hash (SHA-256) do telefone de clientes da Nuvemshop + se já comprou no site. Sem telefone legível. Só a chave de serviço acessa.';

-- RLS
alter table public.painel_usuarios enable row level security;
alter table public.wa_config enable row level security;
alter table public.wa_conversas enable row level security;
alter table public.wa_mensagens enable row level security;
alter table public.wa_log enable row level security;
alter table public.meta_config enable row level security;
alter table public.meta_comentarios enable row level security;
alter table public.meta_log enable row level security;
alter table public.catalogo enable row level security;
alter table public.nuvem_tokens enable row level security;        -- sem política: só a chave de serviço
alter table public.nuvem_clientes_tel enable row level security;  -- sem política: só a chave de serviço

create policy painel_leitura on public.painel_usuarios for select to authenticated using (public.painel_autorizado());
create policy painel_acesso on public.wa_config for all to authenticated using (public.painel_autorizado()) with check (public.painel_autorizado());
create policy painel_acesso on public.wa_conversas for all to authenticated using (public.painel_autorizado()) with check (public.painel_autorizado());
create policy painel_acesso on public.wa_mensagens for all to authenticated using (public.painel_autorizado()) with check (public.painel_autorizado());
create policy painel_acesso on public.wa_log for all to authenticated using (public.painel_autorizado()) with check (public.painel_autorizado());
create policy painel_acesso on public.meta_config for all to authenticated using (public.painel_autorizado()) with check (public.painel_autorizado());
create policy painel_acesso on public.meta_comentarios for all to authenticated using (public.painel_autorizado()) with check (public.painel_autorizado());
create policy painel_acesso on public.meta_log for all to authenticated using (public.painel_autorizado()) with check (public.painel_autorizado());
create policy painel_acesso on public.catalogo for all to authenticated using (public.painel_autorizado()) with check (public.painel_autorizado());

-- Funções: anon não executa nada; contador de não lidas só pelo servidor
revoke execute on function public.wa_incrementa_nao_lidas(text) from public, anon, authenticated;
grant execute on function public.wa_incrementa_nao_lidas(text) to service_role;
revoke execute on function public.painel_autorizado() from public, anon;
grant execute on function public.painel_autorizado() to authenticated, service_role;

-- Linhas de configuração (IA começa em SIMULAÇÃO: nada é enviado ao cliente)
insert into public.wa_config (id) values (1);
insert into public.meta_config (id) values (1);
