// TableTalk — on-demand joke generation.
// Deploy:  supabase functions deploy joke --no-verify-jwt
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)
import Anthropic from "npm:@anthropic-ai/sdk";

const ALLOWED = new Set([
  "https://doghousecode.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED.has(origin) ? origin : "https://doghousecode.github.io";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const STYLES: Record<string, string> = {
  dad: "clean, family-friendly dad jokes or puns, each with the setup and punchline separated by a newline",
  oneliners: "witty one-liners, each a single line with no line breaks",
  limericks: "five-line limericks with an AABBA rhyme scheme",
  xrated: "cheeky, adult, innuendo-based jokes for grown-ups — spicy but not vulgar, crude, or hateful — each with the setup and punchline separated by a newline",
  all: "short, clever, general-audience one-liners, each a single line",
};

const DAILY_LIMIT = 10;   // calls per day, global
const COUNT = 20;         // jokes per call

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
function sbFetch(path: string, init: RequestInit) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: { ...(init.headers || {}), apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY}` },
  });
}

Deno.serve(async (req) => {
  const headers = { ...corsHeaders(req.headers.get("origin")), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers });

  try {
    // Global daily rate limit (atomic in Postgres).
    if (SUPABASE_URL && SERVICE_KEY) {
      const rl = await sbFetch(`/rest/v1/rpc/bump_joke_usage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max_per_day: DAILY_LIMIT }),
      });
      const allowed = await rl.json().catch(() => true);
      if (allowed === false) {
        return new Response(JSON.stringify({ error: "daily limit reached" }), { status: 429, headers });
      }
    }

    const body = await req.json().catch(() => ({}));
    const category: string = body.category || "all";
    const theme = String(body.theme || "").slice(0, 80).trim();
    const about = theme ? ` Every joke must be about: ${theme}.` : "";
    const mixed = !["dad", "oneliners", "limericks", "xrated"].includes(category);

    const TYPE_TO_CAT: Record<string, string> = {
      dad: "dad", oneliner: "oneliners", oneliners: "oneliners",
      limerick: "limericks", limericks: "limericks", xrated: "xrated", "x-rated": "xrated",
    };

    const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
    const prompt = mixed
      ? `Write ${COUNT} distinct jokes as a balanced mix across four types — about five each of: clean family-friendly dad jokes or puns; witty one-liners; five-line AABBA limericks; and cheeky adult innuendo jokes (spicy but not vulgar, crude, or hateful).${about} Return ONLY a JSON array of exactly ${COUNT} objects, each {"type": one of "dad"|"oneliner"|"limerick"|"xrated", "joke": "the joke"}. For dad and xrated jokes, separate setup and punchline with a single \\n inside the joke string.`
      : `Write ${COUNT} distinct ${STYLES[category]}.${about} Return ONLY a JSON array of exactly ${COUNT} strings.`;
    const msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 2200,
      system:
        "You are a sharp comedy writer for a card app called TableTalk. Reply with ONLY valid JSON — no prose, no markdown code fences, no numbering.",
      messages: [{ role: "user", content: prompt }],
    });

    let text = msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
    text = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();

    let items: { cat: string; q: string }[] = [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        if (mixed) {
          items = parsed
            .map((o) => ({ cat: TYPE_TO_CAT[String(o?.type || "").toLowerCase()] || "oneliners", q: String(o?.joke || "").trim() }))
            .filter((o) => o.q);
        } else {
          items = parsed.filter((x) => typeof x === "string" && x.trim()).map((x) => ({ cat: category, q: x.trim() }));
        }
      }
    } catch (_) { /* fall through */ }
    items = items.slice(0, COUNT);
    if (!items.length) return new Response(JSON.stringify({ error: "empty" }), { status: 502, headers });

    // Persist so generated jokes join the deck for everyone.
    if (SUPABASE_URL && SERVICE_KEY) {
      try {
        await sbFetch(`/rest/v1/tabletalk_jokes`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify(items),
        });
      } catch (_) { /* non-fatal — still return the jokes */ }
    }

    return new Response(JSON.stringify({ items }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), { status: 500, headers });
  }
});
