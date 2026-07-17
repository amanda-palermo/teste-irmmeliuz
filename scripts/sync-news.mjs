// Radar RI - sync diario de noticias (Google News RSS) -> Supabase
//
// Roda via `npm run sync-news`. Precisa das variaveis de ambiente descritas em
// .env.example (localmente via arquivo .env, em producao via Secrets do GitHub Actions).
//
// Por enquanto so busca noticias da Meliuz/CASH3 (nao os peers). O feed do Google
// News nao exige chave de API - e um endpoint publico de RSS.
//
// Este script e idempotente: pode rodar quantas vezes quiser que so faz upsert
// por guid (nao duplica materia).

import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`Variavel de ambiente ausente: ${name}. Veja .env.example.`);
  }
  return value;
}

requireEnv("SUPABASE_URL", SUPABASE_URL);
requireEnv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const NEWS_QUERY = "Méliuz OR Meliuz OR CASH3"; // com e sem acento (nem toda fonte grafa "Méliuz" certo) + ticker
const TICKER = "CASH3";
const MAX_ITEMS = 30; // o feed traz ate ~100; guardamos so os mais recentes

// ---------------------------------------------------------------------------
// Parsing manual do RSS (mesmo espirito do parseCsv do sync-market-data.mjs:
// sem dependencia nova so pra ler um formato simples e bem definido).
// ---------------------------------------------------------------------------
function extractTag(xml, tag) {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`).exec(xml);
  return m ? m[1].trim() : null;
}

function decodeXmlEntities(s) {
  if (s == null) return s;
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function parseGoogleNewsRss(xml) {
  const items = [];
  for (const block of xml.split("<item>").slice(1)) {
    const itemXml = block.split("</item>")[0];

    const guid = extractTag(itemXml, "guid");
    const link = extractTag(itemXml, "link");
    const pubDateRaw = extractTag(itemXml, "pubDate");
    const rawTitle = decodeXmlEntities(extractTag(itemXml, "title"));
    if (!guid || !link || !pubDateRaw || !rawTitle) continue;

    const sourceMatch = /<source url="([^"]*)">([^<]*)<\/source>/.exec(itemXml);
    const source = sourceMatch ? decodeXmlEntities(sourceMatch[2]) : null;
    const sourceUrl = sourceMatch ? sourceMatch[1] : null;

    // O titulo do item vem como "Materia - Veiculo"; tiramos o sufixo repetido
    // ja que o veiculo mora separado na tag <source>.
    const title = source && rawTitle.endsWith(` - ${source}`) ? rawTitle.slice(0, -(source.length + 3)) : rawTitle;

    const publishedAt = new Date(pubDateRaw);
    if (isNaN(publishedAt.getTime())) continue;

    items.push({
      guid,
      ticker: TICKER,
      title,
      url: link,
      source,
      source_url: sourceUrl,
      published_at: publishedAt.toISOString(),
    });
  }
  return items;
}

async function fetchNews(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=pt-BR&gl=BR&ceid=BR:pt-BR`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Falha ao baixar o feed de noticias: HTTP ${res.status}`);
  }
  const xml = await res.text();
  return parseGoogleNewsRss(xml).slice(0, MAX_ITEMS);
}

async function main() {
  console.log("== Radar RI: sync de noticias (Google News) ==");

  console.log(`[1/2] Baixando feed para "${NEWS_QUERY}"...`);
  const rows = await fetchNews(NEWS_QUERY);
  console.log(`  ${rows.length} materia(s) encontrada(s).`);

  console.log("[2/2] Upsert em news_mentions...");
  const { error } = await supabase.from("news_mentions").upsert(rows, { onConflict: "guid" });
  if (error) throw new Error(`Erro no upsert de news_mentions: ${error.message}`);

  console.log("== Sync de noticias concluido com sucesso ==");
}

main().catch((err) => {
  console.error("Sync de noticias falhou:", err);
  process.exit(1);
});
