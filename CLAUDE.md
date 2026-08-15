@AGENTS.md

# SabiGame

Web-based, no-download trivia game. Players pick a category, get grouped into a match of up to 4 players (real, filled with bots if fewer are waiting), and race to answer rapid-fire questions. Each question has its own short countdown; the match ends after a fixed number of questions, not elapsed time. Every player who answers correctly scores — faster answers earn more (10/8/7/6 by speed rank).

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

## Matchmaking, real-time loop, and bot fallback — the 4-player redesign

Originally built as strict 1v1 with a 15s match-wide clock. Redesigned to support up to 4 players per match, per-question countdowns instead of a match-wide timer, and a fixed question count instead of elapsed time. This section describes the current design; the 1v1 version is gone (clean-slate migration, no compat shims — there was no production data to preserve).

**Data model**

- `src/lib/categories.ts` — `Category` type (`"football" | "general_knowledge"`), `isCategory` guard
- `matches` — `id`, `category`, `started_at`, `ended_at`, `question_count` (default 10), `question_duration_ms` (default 5000). No `player_1_id`/`player_2_id` — those don't scale past 2, dropped in `20260818000000_multiplayer_matches.sql`. RLS on with a public SELECT policy (safe — no answers live here), and added to the `supabase_realtime` publication so all connected clients see `ended_at` flip via a single DB event.
- `match_results` — this is the SPEC's originally-planned step-7/8 table, built now because the need arose early: `match_id`, `player_id` (real guest ID or a synthetic bot UUID), `is_bot`, `score`, `is_locked` (unused until step 8). Composite PK `(match_id, player_id)`. Doubles as participant roster, live scoreboard, and the eventual score-locking target — one table, not three. RLS on with a public SELECT policy, added to the realtime publication (UPDATE on `score`).
- `match_rounds` — added `round_number` (1-indexed) and `expires_at` (denormalized `started_at + question_duration_ms`, so no join is needed to render a per-question countdown). Unique constraint on `(match_id, round_number)`. `winner_guest_id`/`answered_at` (single-winner leftovers) were later dropped in favor of `resolved_at` — see the multi-scorer section below.
- `round_answers` (added `20260819000000_multi_scorer_rounds.sql`) — `round_id`, `player_id`, `answer_index`, `is_correct`, `answered_at`. Composite PK `(round_id, player_id)` — one answer per player per round, a second submission is rejected via `ON CONFLICT DO NOTHING`. This is what scoring gets computed from; didn't exist under the old single-winner model since only one winner ever needed recording.

**Matchmaking (`supabase/migrations/20260818000002_multiplayer_matchmaking_fns.sql`, fixed in `...000003_fix_match_results_insert.sql`)**

- `matchmaking_try_form_match(p_guest_id, p_category)` — replaces `matchmaking_try_pair`. Inserts the caller into the queue, then tries to atomically claim the 4 oldest queued guests in that category (`FOR UPDATE SKIP LOCKED`, `LIMIT 4`). Claims fewer than 4 → no-op, caller just waits (same polling model as before). Gets exactly 4 → forms the match, creates all 4 `match_results` rows, creates round 1. The claim-first-then-check-count pattern (rather than count-then-claim) is what makes this race-safe: two guests joining in the same instant each independently claim whatever's still unlocked, so you either get two valid disjoint 4-player matches or one match + everyone else still correctly waiting — never a malformed partial match.
- `matchmaking_bot_fallback(p_guest_id)` — still client-poll-driven (`checkMatchmakingStatus` calls it on every poll while waiting; no persistent server timer exists on serverless). Materially different from the old 1v1 version: once the calling guest has waited 15s+, it sweeps up **all** currently-queued guests in that category (up to 4, oldest first, same `SKIP LOCKED` claim pattern), not just the caller — if 3 humans are waiting together, the match starts 3-human-1-bot, not "1 human + 3 bots" while 2 others are stranded. Fills remaining seats (0-3) with fresh `gen_random_uuid()` bot IDs marked `is_bot = true`. At least 1 real player is structurally guaranteed — this function only ever runs because the calling guest is a real, currently-queued human.

**Real-time loop, fixed question count instead of elapsed time**

- `advance_match_round(p_match_id, p_current_round_number)` — the shared core of "what happens after a round is done," called only from `resolve_round` now (see below). Advisory-locks the match (`pg_advisory_xact_lock(hashtext(match_id)::bigint)`), checks whether `round_number + 1` already exists (no-op if so), and either creates the next round or, once `current_round_number >= question_count`, sets `matches.ended_at`. Unchanged since the 4-player redesign.
- `src/app/page.tsx` — unchanged shape (category buttons → `joinMatchmakingQueue`, polls `checkMatchmakingStatus`), just no longer receives/uses `opponentId`
- `src/app/match/[matchId]/page.tsx` — fetches `getMatch`, `getCurrentRound`, `getParticipants`, passes `questionCount` as a prop

## Multi-scorer questions (`20260819000000_multi_scorer_rounds.sql`)

Was single-winner-takes-all with a "first correct answer locks the round" model. Redesigned so every correct answer scores, ranked by speed, and a question waits for its full timer unless everyone's already answered.

**Scoring formula**: among players who answer correctly for a question, rank by `answered_at` ascending and award **10 / 8 / 7 / 6** points for 1st / 2nd / 3rd / 4th-fastest correct. Wrong or no answer: 0. If fewer than 4 answer correctly, only those ranks get filled — nobody picks up a "leftover" rank for answering wrong. Match total = sum across all `question_count` rounds.

- `submit_answer(p_round_id, p_guest_id, p_answer_index)` — no longer decides the outcome. It just records one row into `round_answers` (rejected via `ON CONFLICT DO NOTHING` if this player already answered this round — returned as `recorded: false`), then checks whether every match participant has now answered (`count(round_answers) >= count(match_results)` for this round/match). If so, resolution happens immediately (early exit — nothing left to wait for). Otherwise the round stays open until the timer runs out. Return shape changed: `claimed` → `recorded` (this only tells you "was my answer accepted," not "did I win" — there's no more single winner).
- `resolve_round(p_round_id)` — new, the actual scoring logic. Advisory-locks the match (same key `advance_match_round` uses — Postgres advisory xact locks are per-session reentrant, so `resolve_round` calling `advance_match_round` while already holding the lock is safe, not a deadlock), re-checks `resolved_at IS NULL` under the lock (idempotency guard against a last-answer and a timer-expiry firing near-simultaneously), loops over `round_answers` where `is_correct = true` ordered by `answered_at`, awards `[10,8,7,6][rank]` to each via `match_results.score += points`, sets `match_rounds.resolved_at = now()`, then calls `advance_match_round` to create the next round or end the match. Called from both `submit_answer` (early-exit path) and `expire_round` (timeout path) — same "two triggers converge on one idempotent resolver" pattern the redesign already established for round advancement, just scoring got folded in.
- `expire_round(p_round_id)` — unchanged trigger pattern (client calls it once its local countdown hits zero, server re-verifies `now() >= expires_at`), but now also checks `resolved_at IS NULL` first (an already-resolved round, i.e. everyone answered before the timer ran out, is a no-op) before calling `resolve_round`.
- **The "wait for everyone or the timer" rule lives entirely in `submit_answer`'s answered-count check** — there's no separate flag or scheduled check for it. Every submission re-evaluates "is the room now full," which is what makes early-exit correct without needing to coordinate across requests.
- `src/lib/match/actions.ts` — `RoundInfo.winnerGuestId` → `resolvedAt` (a round no longer has a single winner, but clients still need to know when it's done — e.g. to stop showing "waiting for others"). `SubmitAnswerResult.claimed` → `recorded`. `triggerBotMove`'s early-bail check now reads `resolved_at` instead of `winner_guest_id`.
- `src/lib/match/scoring.ts` — `deriveFeedback` simplified to just `{correct} → "correct" | "wrong"`. The old `"late"` state (someone else claimed it first) doesn't exist anymore — there's no "someone else got it" outcome when everyone who's right scores.
- `src/components/match/MatchRoom.tsx` — per-client "have I answered this round" is now tracked as local component state (`hasAnswered`, reset via the render-time state-reset pattern React recommends for "value changed" resets — `useEffect` + `setState` triggers a lint error for cascading renders, so this compares `round.id` against a tracked `seenRoundId` directly in the render body instead), not derived from a global round field — my own answer button disabling doesn't depend on whether the round has globally resolved, only on whether *I've* already answered. Buttons also disable once `round.resolvedAt` is set (covers the timer-expiry-with-no-answer-from-me case). After answering, shows "Waiting for other players…" if the round hasn't resolved yet.
- `src/lib/match/bot-names.ts` — bots show a display name instead of a generic "Bot" label. `getBotName(playerId)` derives one deterministically from the bot's synthetic UUID (simple string hash mod name-list length) — no DB column needed, and every client computes the same name for the same bot since it's a pure function of an ID everyone already has. Name pool is user-supplied, not generic filler.

Scores are still never tracked client-side beyond mirroring `match_results.score` via realtime UPDATE — that didn't change, only how the server computes what to write there.

## Testing

- Vitest. `npm test` — pure unit tests (`src/**/*.test.ts`, excludes `*.integration.test.ts`), no network, fast. `npm run test:integration` — hits the live Supabase project directly (needs `.env.local`), covers the Postgres RPC layer.
- Pure logic previously inline in `MatchRoom`/`match/actions.ts` was extracted into testable modules so it doesn't need a browser or a live DB to verify: `src/lib/match/countdown.ts` (`computeRemainingMs(expiresAt, now)` — takes an absolute timestamp directly now, no longer a match-wide duration), `src/lib/match/scoring.ts` (just `deriveFeedback` now — the win-counting reducer was removed since `match_results.score` is authoritative and the client no longer tallies wins itself), `src/lib/match/bot-logic.ts` (`pickBotAnswerIndex`, `pickBotDelayMs` — take an injectable random source instead of calling `Math.random()` directly, which is what makes them deterministically testable).
- `src/lib/matchmaking/rpc.integration.test.ts` — the actual game rules live in Postgres functions (`matchmaking_try_form_match`, `matchmaking_bot_fallback`, `submit_answer`, `resolve_round`, `expire_round`, `advance_match_round`), which can't be meaningfully unit-tested without a real Postgres (no Docker in this environment, so no local Supabase stack for pgTAP-style testing). These tests call the RPCs directly against the live project via a raw `@supabase/supabase-js` client (NOT `src/lib/supabase/admin.ts` — that file does `import "server-only"`, which throws when imported outside Next's build pipeline; only Next's webpack config no-ops it) and clean up their own rows in `afterEach`. Cleanup order matters and got one level deeper with `round_answers`: `round_answers` → `match_rounds` → `match_results` → `matches`, since each has an FK to the previous with no `ON DELETE CASCADE` — deleting out of order silently fails via the ignored `error` field rather than throwing.
- Known flake source: this Supabase project has accumulated stray rows from a long session of manual `curl` testing (unpaired `matchmaking_queue` entries, orphaned test `matches`). If an integration test fails with an unexpected pairing/match, suspect pollution before suspecting the RPC logic — rerunning clean (or purging `matchmaking_queue` via the dashboard/REST first) is the fast way to tell the difference. Also watch your own tool-call/reasoning latency when hand-testing `expire_round` timing manually — sequential separate calls easily exceed the 5s question window on their own, which looks like "always expires immediately" but is actually just real elapsed time; test tight timing windows within a single script, not across separate calls.
- `checkMatchmakingStatus`'s "am I in an active match" check uses a PostgREST embedded-resource filter: `.from("match_results").select("match_id, matches!inner(ended_at)").is("matches.ended_at", null)`. Verified directly against the live project both ways (returns the row for an unended match, empty array once `ended_at` is set) before trusting it in the Server Action.

## Fixed issue: client-side match clock (architectural fix, not a patch)

Earlier live-testing via `next dev` produced "flash of a question, then landed on Match ended 0-0" immediately after a bot match started. Root cause: the old 1v1/15s-match-clock design compared a client's `Date.now()` against `matches.started_at`; `next dev` compiles routes on-demand on first hit, and that compile time (plus network round-trips) could eat most of the 15s budget before the client ever mounted its countdown. Confirmed via `next build && next start` (2.5s to first render, not several+ seconds) — it was real, dev-mode-specific, and would not have occurred in production.

The 4-player/per-question-countdown redesign fixes this structurally rather than just working around it: there is no client-side match clock anymore at all. Match-end is now a pure server event (`matches.ended_at` flipping, broadcast to every client via realtime), and the per-question countdown each client renders is purely cosmetic — `expire_round`'s own server-side timestamp check is the sole authority on whether a question's time is actually up. A slow-mounting client can no longer desync the game state, only its own local display.

## Current state

Steps 1-6 of the SPEC.md build order are done:
1. Project scaffolding + Supabase client wiring.
2. Question bank: `supabase/migrations/20260813000000_create_questions.sql` creates the `questions` table; `supabase/seed.sql` seeds 150 hand-written questions (75 Football, 75 General Knowledge).
3. Guest session handling — see above.
4. Matchmaking queue — see above.
5. Real-time match loop — see above.
6. Bot fallback — see above.

Steps 4-5-6 were reworked twice: first from strict 1v1 to up to 4 players per match with per-question countdowns and a fixed question count (10) instead of a match-wide 15s clock, then again from single-winner-takes-all to every-correct-answer-scores with a 10/8/7/6 speed ranking. See the "4-player redesign" and "Multi-scorer questions" sections above for the full data model and RPC rundown.

Verified end-to-end against the live project (via direct RPC calls and a production-build smoke test of `/match/[matchId]`): guest cookie/session flow works; `matchmaking_try_form_match` correctly waits until 4 are queued in the same category, doesn't mix categories, and produces 4 `match_results` rows + a real round 1; `matchmaking_bot_fallback` sweeps up every waiting human after 15s and fills only remaining seats with bots; a round with mixed correct/wrong answers scores exactly 10/8/0/7 by speed and early-exits (advances) the instant the last participant answers, without waiting for the timer; a round where only some players answer correctly and others never answer at all still resolves via timer expiry and scores only who got it right, by speed; a second submission from the same player in the same round is rejected (`recorded: false`); an already-resolved round makes `expire_round` a safe no-op; the match ends (not advances) once `question_count` rounds are done. Production-build smoke test confirmed the match page renders all 4 participants and the question correctly, with `correct_answer_index` never appearing in the response.

31 automated tests now cover this (16 unit + 14 integration — the unit count actually dropped slightly since the multi-scorer change removed a "late" feedback state that had its own test), all passing on a clean DB state.

Nothing else (result screen polish/rematch button, auth/score-locking, leaderboard) has been built yet. There's no nickname UI. The ranked result screen exists (sorts `match_results` by score) but has no "Rematch"/"New Match" buttons yet — that's still step 7 territory, this redesign only rebuilt the minimum needed to not leave the match-end UI broken for N players. Follow the build order in `SPEC.md` for what comes next, and don't skip ahead — later steps depend on earlier ones.

## Scope discipline (v1)

- Guest-first: no account required to play
- Only 2 categories at launch: Football, General Knowledge
- Matches are up to 4 players, at least 1 always real, rest filled with bots on timeout
- Score validation is always server-side, never client-only
- Bot opponents: random correct/incorrect + randomized delay, no real AI
- Web only, no mobile app

## Conventions

- No code comments. Don't add them, even short ones.

## Repo / workflow

- GitHub: https://github.com/Ferinco/sabigame.git
- Push after each change (commit + push to `main` once a change is complete and verified).

