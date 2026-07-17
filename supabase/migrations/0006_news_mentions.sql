-- Radar RI - noticias recentes (secao "Noticias recentes" do Painel CASH3)
-- Rode depois do 0001. Idempotente.
-- Fonte: feed RSS da Google News (scripts/sync-news.mjs). Por enquanto so cobre
-- a Meliuz/CASH3 (nao os peers) - a coluna ticker existe para permitir expandir depois.

create table if not exists public.news_mentions (
  guid          text primary key,  -- guid do item no RSS do Google News (estavel por materia)
  ticker        text not null default 'CASH3' references public.instruments(ticker),
  title         text not null,
  url           text not null,     -- link de redirecionamento do Google News (abre a materia original)
  source        text,              -- nome do veiculo (ex: 'InfoMoney'), vem da tag <source> do RSS
  source_url    text,              -- home do veiculo
  published_at  timestamptz not null,
  inserted_at   timestamptz not null default now()
);
create index if not exists idx_news_mentions_published_at
  on public.news_mentions (ticker, published_at desc);

-- Mesmo padrao das tabelas do Painel CASH3: leitura publica (o site le so com a
-- anon key), escrita apenas via service_role key (usada pelo sync, nunca exposta no site).
alter table public.news_mentions enable row level security;

drop policy if exists "public read news_mentions" on public.news_mentions;
create policy "public read news_mentions" on public.news_mentions
  for select using (true);
