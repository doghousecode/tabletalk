# TableTalk — deployment notes

The app itself (the page, all decks, swipe/save) is a static site on **GitHub Pages**
and deploys automatically: every push to `main` runs `.github/workflows/deploy.yml`
and publishes to https://doghousecode.github.io/tabletalk/ . Nothing to do for that.

Two features rely on **Supabase** and need one-time setup: saved/hidden sync (already
working) and **AI joke generation** (the ✨ box on the Shits & Gigs deck).

---

## 1. Database — run the SQL (Supabase website)

Supabase → your project → **SQL Editor** → **New query** → paste and **Run**.

```sql
-- Saved questions (if not already created)
create table if not exists tabletalk_stars (
  profile text not null, deck text not null, cat text, q text not null,
  created_at timestamptz default now(), primary key (profile, deck, q)
);
alter table tabletalk_stars enable row level security;
create policy "read stars"  on tabletalk_stars for select using (true);
create policy "write stars" on tabletalk_stars for insert with check (true);
create policy "del stars"   on tabletalk_stars for delete using (true);

-- Globally hidden cards (swipe down to hide)
create table if not exists tabletalk_hidden (
  deck text not null, cat text, q text not null,
  created_at timestamptz default now(), primary key (deck, q)
);
alter table tabletalk_hidden enable row level security;
create policy "read hidden" on tabletalk_hidden for select using (true);
create policy "hide"        on tabletalk_hidden for insert with check (true);

-- AI joke generation: daily usage cap
create table if not exists joke_usage (day date primary key, count int not null default 0);
alter table joke_usage enable row level security;  -- only the function (service role) writes it

create or replace function bump_joke_usage(max_per_day int)
returns boolean language plpgsql security definer as $$
declare cur int;
begin
  insert into joke_usage(day, count) values (current_date, 1)
    on conflict (day) do update set count = joke_usage.count + 1
      where joke_usage.count < max_per_day
    returning count into cur;
  return cur is not null;   -- false once the cap is hit
end; $$;

-- AI joke generation: generated jokes that join the deck
create table if not exists tabletalk_jokes (
  id bigint generated always as identity primary key,
  cat text not null, q text not null, created_at timestamptz default now()
);
alter table tabletalk_jokes enable row level security;
create policy "read generated jokes" on tabletalk_jokes for select using (true);
-- inserts come from the Edge Function via the service role, which bypasses RLS
```

---

## 2. Edge Function — deploy `joke` + set the API key

The function lives at `supabase/functions/joke/index.ts`. Pick one route.

### Option A — Supabase website (no CLI)
1. Supabase → **Edge Functions** → **Create a function**, name it exactly **`joke`**.
2. Paste the contents of `supabase/functions/joke/index.ts` and **Deploy**.
3. Turn **Verify JWT = off** for this function (dashboard equivalent of `--no-verify-jwt`).
4. Supabase → **Project Settings → Edge Functions → Secrets** → add
   `ANTHROPIC_API_KEY` = your `sk-ant-...` key (from console.anthropic.com).

### Option B — Terminal (Ghostty), using the Supabase CLI
```bash
brew install supabase/tap/supabase          # one-time
git clone https://github.com/doghousecode/tabletalk.git   # if not already local
cd tabletalk
supabase login                              # opens browser
supabase link --project-ref dycnheibkjjqlmthkkyk
supabase functions deploy joke --no-verify-jwt
supabase secrets set ANTHROPIC_API_KEY=sk-ant-your-key-here
```
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically — don't set them.

---

## 3. Verify

Open the live site → **Shits & Gigs** deck → tap **✨**.
- Jokes appear → working. (Blank box on the **All** chip = an assorted mix; a specific
  chip = 20 of that style; type a theme to make them all about something.)
- "joke failed" → function or `ANTHROPIC_API_KEY` not set up yet.
- "daily limit reached" → working, but the 10-calls/day cap is used up.

## Knobs
- **Model / count / daily cap:** top of `supabase/functions/joke/index.ts`
  (`claude-haiku-4-5`, `COUNT = 20`, `DAILY_LIMIT = 10`). Redeploy after changing.
- **To un-hide a card:** delete its row from `tabletalk_hidden`.
- **To remove a bad generated joke for everyone:** delete its row from `tabletalk_jokes`
  (and, if it was already hidden, from `tabletalk_hidden`).
