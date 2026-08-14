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
- Migrations + seed are applied to the live project (pushed via `supabase db push --db-url ... --include-all --include-seed`, no `supabase link` needed — CLI has no browser/token auth in this environment, so used `--db-url` with the pooler connection string directly). `questions` has 150 rows confirmed live via REST.
- `CREATE OR REPLACE FUNCTION` fails if you change a plpgsql function's return columns — needs `DROP FUNCTION IF EXISTS` first. Bit us once on `matchmaking_try_pair`.
- `questions` has **no** anon/authenticated SELECT policy (dropped in `20260816000000_lock_down_questions.sql` — it originally leaked `correct_answer_index` to anyone hitting the REST API). All question reads go through the service-role client server-side, which explicitly excludes the answer before anything reaches the browser.

## Guest sessions

- `src/lib/guest/constants.ts` — cookie name (`sabigame_guest_id`), header name (`x-sabigame-guest-id`), cookie max-age
- `src/proxy.ts` — Next 16's proxy (formerly `middleware.ts`; must live inside `src/` when using a `src/app` layout — root-level placement is silently ignored). Reads/generates the guest ID, stamps it onto a cloned request header (the documented way to pass data from proxy into render — cookie-mutation tricks don't reliably propagate to the same-request render), sets the persistent cookie on the response for new guests, and calls `refreshSupabaseSession`
- `src/lib/guest/session.ts` — server-only helpers: `getGuestId()` (reads the `x-sabigame-guest-id` header set by proxy), `ensureGuestSession(guestId)` (upserts a `guest_sessions` row, no-op if it exists — called from root layout on every request), `setGuestNickname(guestId, nickname)` (not wired to UI yet — landing page nickname form is future work)
- `supabase/migrations/20260814000000_create_guest_sessions.sql` — `guest_sessions` table, RLS on with zero anon/authenticated policies (guests aren't Supabase Auth users, so writes only ever go through the service-role client server-side)

## Matchmaking queue

- `src/lib/categories.ts` — `Category` type (`"football" | "general_knowledge"`), `isCategory` guard
- `supabase/migrations/20260815000000_create_matches.sql` — `matches` table, RLS on, no client policies (writes and reads are both server-only via the admin client; clients get match state as props from the Server Component, never a direct table read)
- `supabase/migrations/20260815000001_create_matchmaking_queue.sql` — `matchmaking_queue` table, `guest_id` is the primary key (one active queue slot per guest)
- `supabase/migrations/20260815000002_matchmaking_try_pair_fn.sql` — `matchmaking_try_pair(p_guest_id, p_category)` Postgres function: single transaction, `FOR UPDATE SKIP LOCKED` to grab the oldest waiting opponent in that category, avoiding races between two guests joining concurrently. Dequeues + inserts into `matches` if a pair is found; otherwise upserts the caller into the queue. Always removes the caller's own stale queue entry first (prevents self-pairing).
- `src/lib/matchmaking/actions.ts` — Server Actions calling the RPC via the admin client: `joinMatchmakingQueue(category)` (returns `firstRoundId` too, now that pairing also creates round 1), `checkMatchmakingStatus()` (poll-based — see below), `leaveMatchmakingQueue()`

## Real-time match loop

- `supabase/migrations/20260816000001_create_match_rounds.sql` — `match_rounds` table: `match_id`, `question_id`, denormalized `question_text`/`options` (no answer — copied server-side at round-creation time), `started_at`, `winner_guest_id`, `answered_at`. RLS on with a public SELECT policy (`using (true)`) — safe, since the table never carries the answer.
- `supabase/migrations/20260816000002_realtime_publication.sql` — adds `match_rounds` to the `supabase_realtime` publication so `postgres_changes` subscriptions fire on it.
- `supabase/migrations/20260816000003_matchmaking_first_round.sql` — `matchmaking_try_pair` now also picks a random question and inserts the first `match_rounds` row when it creates a match.
- `supabase/migrations/20260816000004_submit_answer_fn.sql` — `submit_answer(p_round_id, p_guest_id, p_answer_index)`: looks up the real `correct_answer_index` from `questions` (never trusts the client), and if it matches, does an atomic `UPDATE match_rounds SET winner_guest_id = ... WHERE winner_guest_id IS NULL` — only the first correct submitter claims it, everyone else racing gets `claimed: false` even if their answer was also correct. On a successful claim it either inserts the next random question (new round → clients pick it up via realtime) or, if `now() >= matches.started_at + 15s`, ends the match (`matches.ended_at`) — the 15s cutoff is enforced in Postgres, not trusted from any client's local clock.
- `src/lib/match/actions.ts` — `getMatch` (now includes `isBotMatch`), `getCurrentRound` (initial state for the Server Component), `submitAnswer` (wraps the RPC), `getMyGuestId`
- `src/app/page.tsx` — landing page (Client Component): category buttons → `joinMatchmakingQueue`, polls `checkMatchmakingStatus` every 2s while waiting, redirects to `/match/[matchId]` once matched
- `src/app/match/[matchId]/page.tsx` — Server Component: fetches match + current round via the admin client, passes them as props (never a client-side table read)
- `src/components/match/MatchRoom.tsx` — Client Component: subscribes to `match_rounds` INSERT (new question) and UPDATE (round claimed, for live scoreboard) via `postgres_changes`, renders question/options, submits answers, runs a local 15s countdown from `matches.started_at` (client-side stop only — server truth is separate and authoritative)

## Bot fallback

- `matches.is_bot_match` (boolean, added in `20260817000000_bot_fallback.sql`) — deviates from the SPEC's literal "player_2_id nullable if bot": bot opponents get a real generated UUID in `player_2_id` instead of NULL, so all the existing winner-tracking/scoring code (which just compares `winner_guest_id` against your own guest id) works unchanged for bot matches without a special case.
- `matchmaking_bot_fallback(p_guest_id)` — no persistent server timer exists (serverless), so this is client-poll-driven: `checkMatchmakingStatus` calls it whenever a guest is still queued. The function re-verifies wait time (15s+) and queue membership itself under `FOR UPDATE SKIP LOCKED`, so it can't race against a real pairing landing at the same instant — whichever transaction gets there first wins, the other is a safe no-op.
- `triggerBotMove(matchId, roundId)` in `src/lib/match/actions.ts` — decides everything server-side: 1.2-5.5s randomized delay, ~55% correct chance, picks a valid wrong index when incorrect, then calls the same `submit_answer` path as a human answer. `MatchRoom` calls this once per round (fire-and-forget, guarded by a ref so it never double-fires) when `isBotMatch` is true — the client only triggers it, it doesn't decide the outcome or timing.

## Current state

Steps 1-6 of the SPEC.md build order are done:
1. Project scaffolding + Supabase client wiring.
2. Question bank: `supabase/migrations/20260813000000_create_questions.sql` creates the `questions` table; `supabase/seed.sql` seeds 150 hand-written questions (75 Football, 75 General Knowledge).
3. Guest session handling — see above.
4. Matchmaking queue — see above.
5. Real-time match loop — see above.
6. Bot fallback — see above.

Verified end-to-end against the live project: guest cookie/session flow works; matchmaking pairing verified via RPC; full match flow verified via RPC (pairing creates round 1 → correct answer within 15s claims the round and creates round 2 → a second, later-arriving correct answer to an already-claimed round gets `claimed: false`, no double scoring → answering after the 15s window ends the match instead of advancing). Match page verified rendering live server-fetched round data (question/options present, `correct_answer_index` never appears in the response). Bot fallback verified: no-ops when called before 15s, fires correctly after, produces a real `is_bot_match=true` match; `triggerBotMove`'s exact algorithm verified against a live match/round (valid question/answer lookup, valid wrong-index selection, correct `submit_answer` integration). Realtime subscription code (postgres_changes for `match_rounds`) matches Supabase's documented pattern but has not been watched live in an actual two-browser-tab session — only server rendering and direct RPC/script calls have been checked so far.

Nothing else (result screen, auth/score-locking, leaderboard) has been built yet. There's no nickname UI, no rematch/new-match flow, and no visible reaction when the match ends for the player who *didn't* submit the game-ending answer (they only find out via their own local countdown hitting zero). Follow the build order in `SPEC.md` for what comes next, and don't skip ahead — later steps depend on earlier ones.

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

