# TableTalk — deployment notes

The app is a static site on **GitHub Pages** and deploys automatically: every push to
`main` runs `.github/workflows/deploy.yml` and publishes to
https://doghousecode.github.io/tabletalk/ . Nothing to do for that.

Two features use **Supabase**: saved questions (`⭐`) and globally-hidden cards
(swipe down). Both fall back to local storage if Supabase is unreachable.

> Note: the AI joke generator was removed. If you set it up before, you can clean up
> the leftovers in Supabase (optional): delete the `joke` Edge Function, remove the
> `ANTHROPIC_API_KEY` secret, and run:
> `drop table if exists tabletalk_jokes; drop table if exists joke_usage; drop function if exists bump_joke_usage(integer);`

---

## Database setup (Supabase → SQL Editor → New query → Run)

```sql
-- Saved questions
create table if not exists tabletalk_stars (
  profile text not null, deck text not null, cat text, q text not null,
  created_at timestamptz default now(), primary key (profile, deck, q)
);
alter table tabletalk_stars enable row level security;
create policy "read stars"  on tabletalk_stars for select using (true);
create policy "write stars" on tabletalk_stars for insert with check (true);
create policy "del stars"   on tabletalk_stars for delete using (true);

-- Globally hidden cards (swipe down)
create table if not exists tabletalk_hidden (
  deck text not null, cat text, q text not null,
  created_at timestamptz default now(), primary key (deck, q)
);
alter table tabletalk_hidden enable row level security;
create policy "read hidden" on tabletalk_hidden for select using (true);
create policy "hide"        on tabletalk_hidden for insert with check (true);
```

- To un-hide a card for everyone: delete its row from `tabletalk_hidden`.
