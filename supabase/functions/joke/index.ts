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
const bucketOf = (c: string) => (["dad", "oneliners", "limericks", "xrated"].includes(c) ? c : "oneliners");

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
    const style = STYLES[category] || STYLES.all;
    const theme = String(body.theme || "").slice(0, 80).trim();
    const about = theme ? ` Every joke must be about: ${theme}.` : "";
    const bucket = bucketOf(category);

    const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
    const msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 2000,
      system:
        "You are a sharp comedy writer for a card app called TableTalk. Reply with ONLY a JSON array of joke strings — no prose, no markdown code fences, no numbering. Each element is one complete joke. For setup-and-punchline jokes, separate the setup from the punchline with a single \\n inside the string.",
      messages: [{ role: "user", content: `Write ${COUNT} distinct ${style}.${about} Return a JSON array of exactly ${COUNT} strings.` }],
    });

    let text = msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
    text = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    let jokes: string[] = [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) jokes = parsed.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim());
    } catch (_) { /* fall through */ }
    if (!jokes.length) jokes = text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
    jokes = jokes.slice(0, COUNT);
    if (!jokes.length) return new Response(JSON.stringify({ error: "empty" }), { status: 502, headers });

    // Persist so generated jokes join the deck for everyone.
    if (SUPABASE_URL && SERVICE_KEY) {
      try {
        await sbFetch(`/rest/v1/tabletalk_jokes`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify(jokes.map((q) => ({ cat: bucket, q }))),
        });
      } catch (_) { /* non-fatal — still return the jokes */ }
    }

    return new Response(JSON.stringify({ jokes, cat: bucket }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), { status: 500, headers });
  }
});
