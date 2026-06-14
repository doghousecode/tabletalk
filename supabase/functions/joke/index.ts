// TableTalk — on-demand joke generation.
// Deploy:  supabase functions deploy joke --no-verify-jwt
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
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
  dad: "a single clean, family-friendly dad joke or pun. Put the setup on the first line, then a newline, then the punchline.",
  oneliners: "a single witty one-liner. Exactly one line, no line breaks.",
  limericks: "a single five-line limerick with an AABBA rhyme scheme, one line each.",
  xrated: "a single cheeky, adult, innuendo-based joke for grown-ups — spicy but not vulgar, crude, or hateful. Put the setup on the first line, then a newline, then the punchline.",
  all: "a single short, clever, general-audience joke.",
};

Deno.serve(async (req) => {
  const headers = { ...corsHeaders(req.headers.get("origin")), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers });

  try {
    const body = await req.json().catch(() => ({}));
    const category: string = body.category || "all";
    const style = STYLES[category] || STYLES.all;
    const theme = String(body.theme || "").slice(0, 80).trim();
    const about = theme ? ` The joke must be about: ${theme}.` : "";

    const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
    const msg = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 400,
      system:
        "You are a sharp comedy writer for a card app called TableTalk. Reply with ONLY the joke text — no preamble, no quotation marks, no explanation, and no list of options. Separate a setup from its punchline with a single newline.",
      messages: [{ role: "user", content: `Write ${style}${about}` }],
    });

    const joke = msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
    if (!joke) return new Response(JSON.stringify({ error: "empty" }), { status: 502, headers });
    return new Response(JSON.stringify({ joke }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), { status: 500, headers });
  }
});
