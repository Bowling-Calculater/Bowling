# Pot of Gold scorer

Phone-first static site that scores a Pot of Gold league night (3 games, 35 points) from photos of the lane TV screen.
Teammates snap each lane's screen after a game. A Supabase Edge Function sends the photo to Gemini, which returns strict JSON.
Every phone then sees the matchups, game points, and running night total live (Supabase Realtime). Anyone with the team code can tap a number to fix it, and the night re-scores for everyone.

```
index.html  style.css  app.js        static site (no build step), GitHub Pages
config.js                            SUPABASE_URL / SUPABASE_ANON_KEY placeholders (public values only)
scoring.js                           league scoring + consistency checks (shared by site and tests)
tests/                               node --test: answer key (3 games + night), ties, absentee, vacancy, flags, schema
supabase/migrations/…_init.sql       tables nights/games/reads, RLS (anon read-only), realtime, "screens" bucket
supabase/functions/read-screen/      Edge Function (Deno): team-code check, upload, Gemini read, fix/discard/retry
supabase/functions/_shared/read-schema.js   JSON schema + prompt + validator (used by the function and the tests)
```

## Scoring rules implemented
- Lineup spot N plays spot N. Each bowler game is worth 1 pt on the handicap game (15 total), each bowler series 2 pts on the 3-game handicap total (10), each team game 2 pts on the team handicap total (6), and the team series 4 pts (4). That makes 35.
- Ties split the points (0.5/0.5, 1/1, 2/2). This is Tanner's house rule.
- Absent (blind) bowler: the screen's score is used if one is shown. If the screen is blank, the scratch is average − 10 (capped at 235). The average is worked back from the handicap (90% of 235 − avg), and the value is marked as an estimate to check.
- Vacancy: 100 scratch + 121 handicap = 221.
- A blind or vacant bowler can't win points. Against a vacancy, the opponent must bowl within 10 of their average, or 30 for the series, to take the point. Their average comes from their handicap; if it can't be worked out, the point is flagged for a manual check.
- A team made up entirely of blind or vacant bowlers can't win team points.
- Not automated (flagged instead): forfeits and illegal lineups, team-vs-vacant-team "within 50 of average", and averages that change mid-night.

## Checks that highlight numbers (red = inconsistent, amber = reader unsure)
- scratch + hcp ≠ handicap game
- Σ bowler scratch ≠ team scratch, Σ handicap games ≠ team total, team scratch + team hcp ≠ team total
- A number is missing, impossible (scratch > 300), or not 5 bowlers
- The bowler's handicap changed between games, or the name at a lineup spot changed (series is scored by spot)
- Gemini marked the row or field as unsure
- Two photos of the same team and game: the newest one is used. "Hide" drops a bad photo, and "Re-read" sends it to Gemini again.

## Current deployment (Nov 2, 2026)
- Supabase project `jhqzromleqpwfvhstzlg` (`https://jhqzromleqpwfvhstzlg.supabase.co`). All 3 migrations are applied, and the `read-screen` function is deployed with verify_jwt off. `config.js` is filled in.
- The team code is in Vault as `team_code`.
- **Gemini key: still needs to be set.** In the dashboard, go to Edge Functions → Secrets → add `GEMINI_API_KEY`. An env secret takes precedence over Vault. The Vault entry `gemini_api_key` currently holds a redacted placeholder, not the real key.
- Still to do: push this folder to GitHub Pages (step 7).

## Deploy (all free tiers)

You'll need Node 18+ (only for tests), the Supabase CLI (`npm i -g supabase` or `brew install supabase/tap/supabase`), and a GitHub account.

1. **Supabase project**: at supabase.com, create a new project on the Free plan. In Project Settings, copy:
   - **Project ref** (e.g. `abcdefghijklmnop`) and **Project URL** `https://<ref>.supabase.co`
   - **API key**: the `anon` (legacy) key or the `sb_publishable_…` key. Do *not* use the service_role / secret key in the site.
2. **Database + bucket + realtime**: use either option.
   - Dashboard → SQL Editor → paste and run the files in `supabase/migrations/`, in order, **or**
   - `supabase login` → `supabase link --project-ref <ref>` → `supabase db push`
   
   Check that Storage shows a public bucket `screens`. The SQL also adds `reads` to the `supabase_realtime` publication.
3. **Gemini key**: go to aistudio.google.com → *Get API key* → create a key in a project **with no billing account**, so it stays on the free tier. Free-tier prompts may be used by Google to improve its products.
4. **Secrets** (pick your own team code):
   ```
   supabase secrets set --project-ref <ref> GEMINI_API_KEY=<key> TEAM_CODE=<code-teammates-type>
   # optional: supabase secrets set --project-ref <ref> GEMINI_MODEL=gemini-3.6-flash
   ```
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into Edge Functions automatically.

   **Alternative without the CLI: Supabase Vault.** Apply `supabase/migrations/20261102000100_secret_accessor.sql`, then run this in the SQL Editor:
   `select vault.create_secret('<key>', 'gemini_api_key'); select vault.create_secret('<code>', 'team_code');`
   The function reads env secrets first. If they're missing, it reads Vault through `public.get_app_secret()`, which only `service_role` can execute.

   Models are tried in this order: `GEMINI_MODEL` (default `gemini-3.6-flash`), then `gemini-3.5-flash`, then `gemini-flash-latest`. The next one is used on a 404 (retired) or 503 (overloaded). `gemini-2.5-flash` now returns 404 for new keys.
5. **Edge Function**:
   ```
   supabase functions deploy read-screen --project-ref <ref> --no-verify-jwt
   ```
   (Add `--use-api` if Docker isn't installed.) `--no-verify-jwt` is required because the browser authenticates with the team code. Without it, the function rejects `sb_publishable_` keys.
6. **config.js**: set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `MY_TEAM` (that team is shown in the left column).
7. **GitHub Pages**: create a repo, then commit and push these files to `main`. Go to Settings → Pages → *Deploy from a branch* → `main` / `/ (root)`. The site goes live at `https://<user>.github.io/<repo>/`. `.nojekyll` is included.
8. **Smoke test**: open the site, enter the team code, pick Game 1, and use "choose photos" to upload `lane3_game1.png` + `lane4_game1.png` from the test folder. Expect 4–3 for game 1.

## Local use
- `npm test` runs the scoring + schema tests. The answer key is read from `../2026-11-02-bowling-test/answer_key.json`, or set `ANSWER_KEY=/path`.
- `python3 -m http.server 8000` serves the site locally (it still talks to your Supabase project).
- The function can run locally with `supabase functions serve read-screen --no-verify-jwt --env-file .env`. Never commit `.env`.

## Free-tier notes
- A Supabase Free project **pauses after ~7 days without activity**. A weekly league is right at that limit, so open the site once mid-week or restore the project from the dashboard if it's paused.
- Storage use is about 0.5 MB per photo (the phone downsizes to 2048 px JPEG before upload), so the 1 GB limit holds years of league nights.
- The Gemini free tier has per-day/per-minute limits. One night is about 6–8 calls (plus retries).

## Security model
- The browser holds only the public anon/publishable key, and RLS lets it **read** nights, games, and reads.
- All writes go through the function with the service role, and only after a constant-time check of `TEAM_CODE`. Anon has no insert/update/delete grants or policies, and there are no storage upload policies.
- The Gemini key lives only in Edge Function secrets or Vault. `get_app_secret` is SECURITY DEFINER with an empty search_path, and EXECUTE is revoked from public, anon, and authenticated. The `vault` schema isn't exposed over the API.
- Photos are in a public bucket under unguessable UUID paths, so anyone who has a link can see a photo of the lane screen.
