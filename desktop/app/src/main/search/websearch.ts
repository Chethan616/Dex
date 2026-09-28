// dex-websearch's backend — a first-class factual-lookup tool, matching
// Codex's web_search, for questions that don't need a browser session at
// all ("what's the current Node LTS version"). Routed through Brave
// Search's REST API (key-based, no scraping) rather than driving Google
// through browser-harness-js, which is much heavier for a plain lookup.
const BRAVE_SEARCH_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

export interface WebSearchItem {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResult {
  ok: boolean;
  items: WebSearchItem[];
  error?: string;
}

function apiKeyFromEnv(): string | null {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  return key && key.trim().length > 0 ? key.trim() : null;
}

interface BraveSearchResponseWebResult {
  title?: string;
  url?: string;
  description?: string;
}

interface BraveSearchResponse {
  web?: { results?: BraveSearchResponseWebResult[] };
}

export async function searchWeb(
  query: string,
  limit = 10,
  fetchImpl: typeof fetch = fetch,
  apiKey: string | null = apiKeyFromEnv(),
): Promise<WebSearchResult> {
  if (!apiKey) {
    return {
      ok: false,
      items: [],
      error: 'No web search API key configured. Set BRAVE_SEARCH_API_KEY in the environment.',
    };
  }
  const url = new URL(BRAVE_SEARCH_ENDPOINT);
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(Math.min(Math.max(limit, 1), 20)));

  let res: Response;
  try {
    res = await fetchImpl(url.toString(), {
      headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
    });
  } catch (err) {
    return { ok: false, items: [], error: `Could not reach the web search API: ${(err as Error).message}` };
  }
  if (!res.ok) {
    return { ok: false, items: [], error: `Web search API returned HTTP ${res.status}` };
  }
  const data = (await res.json()) as BraveSearchResponse;
  const items: WebSearchItem[] = (data.web?.results ?? [])
    .filter((r): r is Required<BraveSearchResponseWebResult> => Boolean(r.title && r.url))
    .map((r) => ({ title: r.title, url: r.url, snippet: r.description ?? '' }));
  return { ok: true, items };
}
