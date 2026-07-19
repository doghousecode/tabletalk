# TableTalk — deployment notes

The app is a fully static, self-contained site on **GitHub Pages**. Every push to
`main` runs `.github/workflows/deploy.yml` and publishes to
https://doghousecode.github.io/tabletalk/ . There is **no backend** — nothing to
configure, no keys, no database, no ongoing cost. Sharing the URL is all that's needed.

- **Saved cards** (`⭐`) and **hidden cards** (swipe down on Giggles) are stored in the
  browser's `localStorage`, per device. They're private to that device and work offline.
- It's an installable PWA: open in a browser once (to cache), then use "Add to Home
  Screen" to run it like an app, offline.

### Optional Supabase cleanup
Earlier versions used Supabase for sync and AI joke generation, both now removed.
If you set that up, you can tear it down: delete the `joke` Edge Function, remove the
`ANTHROPIC_API_KEY` secret, and drop the tables:

```sql
drop table if exists tabletalk_stars;
drop table if exists tabletalk_hidden;
drop table if exists tabletalk_jokes;
drop table if exists joke_usage;
drop function if exists bump_joke_usage(integer);
```
