@AGENTS.md

# SabiGame

Web-based, no-download trivia game. Players pick a category, get matched with an opponent (real or bot), and race to answer rapid-fire questions for 15 seconds. First correct tap each round scores.

Full product spec: see `SPEC.md` (source of truth for flow, data model, and build order — check it before making product decisions).

## Stack

- Next.js (App Router) + TypeScript, `src/` directory, `@/*` import alias
- Tailwind CSS
- Supabase: Postgres + Realtime channels + Auth
- Hosting target: Vercel (app), Supabase Cloud (backend)

## Supabase client setup

- `src/lib/supabase/client.ts` — browser client (Client Components)
- `src/lib/supabase/server.ts` — server client (Server Components/Actions, async, cookie-based)
- `src/lib/supabase/middleware.ts` (`refreshSupabaseSession`) + `src/proxy.ts` — refreshes the auth session on every request
- `src/lib/supabase/admin.ts` — service-role client, server-only, bypasses RLS (used for writes like `guest_sessions` that anon policies intentionally don't allow)
- Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (see `.env.local.example`; actual values go in untracked `.env.local`)
- All three env vars are live real values in `.env.local` (URL, anon key, service role key).
- Migrations + seed are applied to the live project (pushed via `supabase db push --db-url ... --include-all --include-seed`, no `supabase link` needed — CLI has no browser/token auth in this environment, so used `--db-url` with the pooler connection string directly). `questions` has 150 rows confirmed live via REST; `guest_sessions` exists with RLS blocking anon reads as designed.

## Guest sessions

- `src/lib/guest/constants.ts` — cookie name (`sabigame_guest_id`), header name (`x-sabigame-guest-id`), cookie max-age
- `src/proxy.ts` — Next 16's proxy (formerly `middleware.ts`; must live inside `src/` when using a `src/app` layout — root-level placement is silently ignored). Reads/generates the guest ID, stamps it onto a cloned request header (the documented way to pass data from proxy into render — cookie-mutation tricks don't reliably propagate to the same-request render), sets the persistent cookie on the response for new guests, and calls `refreshSupabaseSession`
- `src/lib/guest/session.ts` — server-only helpers: `getGuestId()` (reads the `x-sabigame-guest-id` header set by proxy), `ensureGuestSession(guestId)` (upserts a `guest_sessions` row, no-op if it exists — called from root layout on every request), `setGuestNickname(guestId, nickname)` (not wired to UI yet — landing page nickname form is future work)
- `supabase/migrations/20260814000000_create_guest_sessions.sql` — `guest_sessions` table, RLS on with zero anon/authenticated policies (guests aren't Supabase Auth users, so writes only ever go through the service-role client server-side)

## Matchmaking queue

- `src/lib/categories.ts` — `Category` type (`"football" | "general_knowledge"`), `isCategory` guard
- `supabase/migrations/20260815000000_create_matches.sql` — `matches` table, RLS on, no client policies yet (writes are server-only; whether clients need direct read access gets decided in step 5, when the realtime loop's read pattern is clear)
- `supabase/migrations/20260815000001_create_matchmaking_queue.sql` — `matchmaking_queue` table, `guest_id` is the primary key (one active queue slot per guest)
- `supabase/migrations/20260815000002_matchmaking_try_pair_fn.sql` — `matchmaking_try_pair(p_guest_id, p_category)` Postgres function: single transaction, `FOR UPDATE SKIP LOCKED` to grab the oldest waiting opponent in that category, avoiding races between two guests joining concurrently. Dequeues + inserts into `matches` if a pair is found; otherwise upserts the caller into the queue. Always removes the caller's own stale queue entry first (prevents self-pairing).
- `src/lib/matchmaking/actions.ts` — Server Actions calling the RPC via the admin client: `joinMatchmakingQueue(category)`, `checkMatchmakingStatus()` (poll-based — the already-waiting player has no push notification until step 5's realtime channel exists), `leaveMatchmakingQueue()`

## Current state

Steps 1-4 of the SPEC.md build order are done:
1. Project scaffolding + Supabase client wiring.
2. Question bank: `supabase/migrations/20260813000000_create_questions.sql` creates the `questions` table (RLS enabled, public read-only); `supabase/seed.sql` seeds 150 hand-written questions (75 Football, 75 General Knowledge).
3. Guest session handling — see above.
4. Matchmaking queue — see above.

Verified end-to-end against the live project: hitting `/` returns 200, sets the `sabigame_guest_id` cookie, and no longer errors on `ensureGuestSession`. Matchmaking pairing verified directly via RPC (two guest IDs, same category — first got queued, second got paired with the first as opponent, queue row cleaned up, one `matches` row created).

Nothing else (realtime match loop, bot fallback, result screen, auth/score-locking, leaderboard) has been built yet, and no UI exists yet — everything so far is server-side (Server Actions/proxy/DB). Follow the build order in `SPEC.md` for what comes next, and don't skip ahead — later steps depend on earlier ones.

## Scope discipline (v1)

- Guest-first: no account required to play
- Only 2 categories at launch: Football, General Knowledge
- Score validation is always server-side, never client-only
- Bot opponents: random correct/incorrect + randomized delay, no real AI
- Web only, no mobile app

## Conventions

- No code comments. Don't add them, even short ones.

## Repo / workflow

- GitHub: https://github.com/Ferinco/sabigame.git
- Push after each change (commit + push to `main` once a change is complete and verified).

