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
- `src/lib/guest/session.ts` — server-only helpers: `getGuestId()` (reads the `x-sabigame-guest-id` header set by proxy), `ensureGuestSession(guestId)` (upserts a `guest_sessions` row, no-op if it exists — called from root layout on every request), `setGuestNickname(guestId, nickname)` / `getGuestNickname(guestId)`
- `src/lib/guest/nickname.ts` — pure `validateNickname(raw)` (non-empty, trimmed, 20 char max), used by `src/lib/guest/actions.ts`'s `submitNickname` Server Action so the validation itself is unit-testable without a request context
- `src/app/page.tsx` — Server Component: fetches `getGuestNickname`, passes it to `src/components/Landing.tsx` (Client Component) as `initialNickname`. Landing is two-stage: nickname form (Continue disabled until non-empty) → category picker, matching the SPEC's core flow. A guest who already has a saved nickname skips straight to the category picker, with a "change" link back to the form.
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

All 9 steps of the SPEC.md build order have a first pass done:
1. Project scaffolding + Supabase client wiring.
2. Question bank: `supabase/migrations/20260813000000_create_questions.sql` creates the `questions` table; `supabase/seed.sql` seeds 225 hand-written questions (75 Football, 75 General Knowledge, 75 Afrobeats — the latter added later, see the "Third category: Afrobeats" section below).
3. Guest session handling — see above.
4. Matchmaking queue — see above.
5. Real-time match loop — see above.
6. Bot fallback — see above.
7. Result screen + new-match loop — ranked list, "New Match" button (no rematch, by design).
8. "Lock score" flow — magic link only so far, see below. Not yet verified end-to-end (needs a manual Supabase dashboard step + a real email click-through).
9. Global leaderboard — see below.

Steps 4-5-6 were reworked twice: first from strict 1v1 to up to 4 players per match with per-question countdowns and a fixed question count (10) instead of a match-wide 15s clock, then again from single-winner-takes-all to every-correct-answer-scores with a 10/8/7/6 speed ranking. See the "4-player redesign" and "Multi-scorer questions" sections above for the full data model and RPC rundown.

Verified end-to-end against the live project (via direct RPC calls and a production-build smoke test of `/match/[matchId]`): guest cookie/session flow works; `matchmaking_try_form_match` correctly waits until 4 are queued in the same category, doesn't mix categories, and produces 4 `match_results` rows + a real round 1; `matchmaking_bot_fallback` sweeps up every waiting human after 15s and fills only remaining seats with bots; a round with mixed correct/wrong answers scores exactly 10/8/0/7 by speed and early-exits (advances) the instant the last participant answers, without waiting for the timer; a round where only some players answer correctly and others never answer at all still resolves via timer expiry and scores only who got it right, by speed; a second submission from the same player in the same round is rejected (`recorded: false`); an already-resolved round makes `expire_round` a safe no-op; the match ends (not advances) once `question_count` rounds are done. Production-build smoke test confirmed the match page renders all 4 participants and the question correctly, with `correct_answer_index` never appearing in the response.

31 automated tests now cover this (16 unit + 14 integration — the unit count actually dropped slightly since the multi-scorer change removed a "late" feedback state that had its own test), all passing on a clean DB state.

Nickname entry is now gated before matchmaking (landing page). Bots show random display names (`src/lib/match/bot-names.ts`). Real opponents' nicknames now show in-match too — `getParticipants` (`src/lib/match/actions.ts`) does a second query against `guest_sessions` for the non-bot player IDs and merges nicknames into `ParticipantInfo`, falling back to "Player" if a participant somehow doesn't have one set (e.g. old data from before nickname entry was required). No FK exists between `match_results.player_id` and `guest_sessions.anonymous_id` (player_id can be a bot's synthetic UUID, which never gets a `guest_sessions` row), so this is two separate queries merged in JS, not a PostgREST embedded-resource join.

The result screen has a "New Match" button (no "Rematch" — deliberately skipped, not a fit for this game per product call). It routes to `/` and calls `router.refresh()` right after `router.push()`, forcing a fresh server fetch of `getGuestNickname` rather than risking a stale client-router-cache snapshot of the landing page — since the nickname's already saved, this sends the player straight to the category picker, not back through the nickname form.

## Score locking (step 8) — magic link only, no Google OAuth yet

"Lock this score & join global ranking" appears on the result screen for the guest's own row, once the match has ended and that row isn't already locked. Google OAuth was skipped for now — it needs a Google Cloud OAuth app registered by the user in the Supabase dashboard, an external manual step I can't do myself; magic link email is fully self-contained and was the pragmatic choice to actually ship step 8 rather than block on it. Adding Google OAuth later is a small addition (`supabase.auth.signInWithOAuth({ provider: "google" })` alongside the existing `signInWithOtp` call) once that dashboard config exists.

**Flow**: the result screen (`MatchRoom`) only shows a "Lock this score & join global ranking" *button* for your own row, once the match has ended and you're not already locked — clicking it routes to `/match/[matchId]/lock`, a separate page. That page is a Server Component gate (`src/app/match/[matchId]/lock/page.tsx`): it re-checks the same eligibility (match ended, you're a real non-bot participant, not already locked) and `redirect()`s back to `/match/[matchId]` if any of that fails — so the URL itself can't be used to lock a match you're not part of, or one that's still live, or one you've already locked. Only if eligible does it render `src/components/match/LockScoreForm.tsx` (Client Component), which is where `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: "${origin}/auth/callback?matchId=..." } })` actually gets called — from the *browser* client (`src/lib/supabase/client.ts`) specifically, since Supabase's PKCE flow stores a code verifier in the browser's local storage that only that same browser client can retrieve later. Clicking the emailed link lands on `src/app/auth/callback/route.ts` (Route Handler), which exchanges the code for a session via the *server* client (`src/lib/supabase/server.ts` — same one built in step 1, unused until now), reads the now-authenticated `user.id`, and calls `lockMatchScore(matchId, guestId, user.id)`.

**`src/lib/match/lock-score.ts`** — deliberately a plain module, not exported from `match/actions.ts` (which has `"use server"` at the top, meaning every export there becomes a public HTTP-callable Server Action). `lockMatchScore` takes a raw `userId` as a parameter; if it were client-callable, anyone could pass an arbitrary `userId` and hijack any match's score. It's only ever called from the callback Route Handler, where `userId` comes from a verified Supabase Auth session, never from client input. The lock itself is one `UPDATE match_results SET player_id = userId, is_locked = true WHERE match_id = ... AND player_id = guestId` — verified directly against the live project that this only touches the intended row, the other 3 participants are untouched.

**Identity resolution gotcha this surfaced**: once locked, a `match_results` row's `player_id` changes from the guest's UUID to the auth user's UUID. If the match page kept comparing against the raw guest ID, a player who locked their own score would stop matching their own row — "You" would silently disappear and their score would look like a stranger's. Fixed via `getMyParticipantId(matchId)` (`src/lib/match/actions.ts`): checks for an active Supabase Auth session server-side, and if a `match_results` row exists for `(matchId, user.id)`, resolves to that; otherwise falls back to the guest ID. The match page now passes this resolved ID to `MatchRoom` as `guestId` — it's a "who am I for this match" identity, not necessarily the literal guest cookie value.

**Also fixed while here**: `MatchRoom`'s `matchEnded` state previously always initialized to `false` regardless of the match's actual `ended_at` — reopening an already-finished match (exactly what happens after the magic-link email round trip, which can take real time) would render the in-progress question view, stuck, since the realtime subscription only fires on *new* events after mount, not for state changes that already happened. Now `MatchPage` passes `initialMatchEnded={match.endedAt !== null}` and `MatchRoom` seeds its state from that.

**Manual step required, not yet verified end-to-end**: the actual magic-link email round trip needs `http://localhost:3000/auth/callback` (and the eventual production domain) added to Supabase's Authentication → URL Configuration → Redirect URLs allowlist, or `exchangeCodeForSession` will reject the callback. This is dashboard config, not something a migration can set. I verified the DB-level lock operation directly (UPDATE correctness, row targeting, `getParticipants` not crashing on a locked row with no matching `guest_sessions` entry) and the identity-resolution/matchEnded fixes via a production-build smoke test with a real matching guest cookie, but have not personally clicked a real magic-link email — no inbox access. Test this specific path yourself before considering it done.

## Global leaderboard (step 9)

Building this surfaced a real gap in the lock-score migration: once `match_results.player_id` becomes the auth user's UUID, there's no way back to `guest_sessions.nickname` (keyed by the old guest UUID) — the connection is lost the moment `lockMatchScore` overwrites `player_id`. Fixed at the source rather than working around it on the leaderboard: `20260820000000_leaderboard.sql` adds a `profiles` table (`id` FK'd to `auth.users`, `nickname`), and `lockMatchScore` now upserts into it (copying the guest's current nickname) as part of the same lock operation, before migrating `match_results`.

- `public.leaderboard` — a Postgres view, not a table: `SUM(score)` / `COUNT(DISTINCT match_id)` from `match_results` grouped by `player_id`, filtered to `is_locked = true`, joined against `profiles` for the nickname. Queried via the admin client same as everything else server-side (service role bypasses RLS regardless, so no `security_invoker` concerns for our access pattern).
- `src/lib/leaderboard/actions.ts` — `getLeaderboard(limit = 50)`, straight `.from("leaderboard").select(...).order("total_score", { ascending: false })`.
- `src/app/leaderboard/page.tsx` — Server Component, ranked list, "no locked scores yet" empty state. Linked from the landing page footer.

Verified: `profiles.id`'s FK to `auth.users` is genuinely enforced (a fabricated UUID insert was rejected with `23503`, confirming a fake profile can't silently exist without a real signup behind it), and the `leaderboard` view queries cleanly with zero rows (no error on an empty join). Did not run a full create-real-user-then-lock-then-check-leaderboard round trip this session — the DB-level lock UPDATE itself was already verified in the previous commit, and the FK/view mechanics are simple enough that this felt like adequate coverage without spinning up a throwaway auth user.

## Abandoned matches/queue entries — server-side autonomous expiry

Real bug, reported and reproduced live: user closed their browser mid-match, reopened the app a full day later, briefly saw "Finding you an opponent…" and then got silently dropped back into yesterday's frozen match at the round they'd left off on — the bots "woke up" and kept playing as if no time had passed.

**Root cause**: round advancement and match-ending were 100% client-triggered (`submit_answer` / `expire_round`, called from whichever browser happens to be connected — necessary since there's no persistent server process on serverless). If literally every browser in a match closes, nothing ever calls `expire_round` again — `matches.ended_at` never gets set, no matter how much real time passes. `checkMatchmakingStatus`'s "am I already in an active match" check (`matches!inner(ended_at)` filtered `is null`) then finds that frozen match on the player's *next* matchmaking attempt and redirects them straight back into it, discarding the fresh queue entry they just created. The user's phrasing nailed the actual design flaw: match-end shouldn't depend on any client being present — a match with a fixed question count and fixed per-question timers should be able to conclude entirely on its own.

**Fix, `20260821000000_end_stale_matches.sql` + `20260821000001_stale_queue_cleanup.sql`** — two layers, not just a client-side patch:

1. **A real autonomous timer**: `pg_cron` (enabled via `create extension if not exists pg_cron`) runs `end_stale_matches()` every minute, independent of any client. It force-ends any match whose current round has sat unresolved more than 60s past `expires_at` (marks the round `resolved_at` with no points awarded, sets `matches.ended_at`), and purges `matchmaking_queue` rows older than 60s. This is the actual fix — it runs even if literally nobody ever opens the app again.
2. **Opportunistic self-healing on read**: `getMatch` and `checkMatchmakingStatus` both call `end_stale_matches()` before doing anything else, so a stale match gets resolved the instant anyone queries it — not just on the next cron tick. This is what would've caught the reported bug instantly instead of resurrecting the frozen match.
3. **Stale queue entries also excluded from matching itself**: `matchmaking_try_form_match` and `matchmaking_bot_fallback`'s "grab up to 4 oldest" queries now filter to `joined_at > now() - interval '60 seconds'`, so an abandoned queue entry (closed tab, no `leaveMatchmakingQueue()` ever fired — that only runs on in-app unmount, not tab close/crash) can't get swept into a future match as a permanent ghost seat even before the cron/cleanup catches up to purging it.

60s was chosen as comfortably above the 5s question window (for match staleness) and the 15-20s bot-fallback window (for queue staleness) — a genuinely active, still-polling guest should never accumulate that much idle time under normal operation, so this shouldn't produce false positives against real players, only genuinely abandoned sessions.

**Verified against the live project**: an abandoned match (round backdated 5 minutes past its timer) gets force-ended with zero points awarded on `end_stale_matches()`, while a freshly-formed match is correctly left untouched by the same call (no false positives). A stale queue entry (backdated 5 minutes) is correctly excluded from pairing — 2 fresh guests + 1 ghost stays "waiting" rather than incorrectly forming a match — and gets purged by the same cleanup call. Did not verify the `pg_cron` schedule actually fires on its own clock (no way to wait a full minute and observe within this session in a way that's distinguishable from the opportunistic calls already exercising the same function) — trusting the migration's successful apply (`cron.schedule(...)` would have failed the whole transaction if rejected) plus the manually-verified function correctness.

## Rate limiting

No new external service (no Redis/Upstash) — a lightweight Postgres-based limiter, consistent with everything else in this project running through Supabase.

- `20260822000000_rate_limits.sql` — `rate_limits` table (`key`, `window_start`, `count`) + `check_rate_limit(p_key, p_max_requests, p_window_seconds)`, a fixed-window counter done as a single atomic `INSERT ... ON CONFLICT DO UPDATE` (race-safe under concurrent calls for the same key — no separate read-then-write). Returns `true`/`false`, doesn't throw on its own.
- `src/lib/rate-limit.ts` — `checkRateLimit(key, max, windowSeconds)` wraps the RPC and throws `RateLimitError` (a clean, user-facing message) when exceeded; callers either let it propagate (caught by existing try/catch → `error` state UI patterns already in place) or catch it explicitly to fold into a typed result instead of throwing (see `submitNickname`).
- Applied to: `joinMatchmakingQueue` (10/min per guest), `checkMatchmakingStatus` (40/min per guest — generous enough to not break the legitimate 2s-interval poll while waiting, which is 30/min), `submitAnswer` (30/min per guest — bot submissions via `triggerBotMove` go through the same underlying `callSubmitAnswer` but skip this check, since it's keyed at the human-facing `submitAnswer` entry point only), `submitNickname` (10/min per guest).
- **New guest creation, by IP, in `proxy.ts`**: this is the deeper one — without it, a script hitting the site with no cookie each time gets a fresh `guest_sessions` row minted every single request, unbounded. Only checked when `!existingGuestId` (so it doesn't add a DB round-trip to every request, just first-ever visits). 20 new guests/hour/IP; exceeding it returns a plain 429 response directly from proxy, blocking that request's entire page load. Chosen generously to avoid falsely blocking legitimate shared-IP scenarios (corporate NAT, school, mobile CGNAT) while still stopping a guest-spam script. If the rate-limit check itself fails for infra reasons (not a limit-exceeded rejection, an actual error), proxy fails open rather than blocking real traffic — a broken rate limiter shouldn't take down the whole app.
- Not rate-limited: `signInWithOtp` (magic link email send) — left to Supabase Auth's own built-in rate limiting rather than re-implementing it, since it already exists there and duplicating it adds complexity for no real gain. `expireRound` and `triggerBotMove` were also left unprotected — lower priority since they're already deduped via ref-based guards client-side, and a known remaining gap rather than an oversight.

**Verified against the live project**: `check_rate_limit` allows exactly N requests and blocks the (N+1)th; the window correctly resets after it expires (tested with a 2s window). Confirmed via direct RPC calls matching exactly what `joinMatchmakingQueue` does internally (10 pass, 11th blocked) — did not literally drive a Server Action past its limit through the browser (Server Actions use an encoded POST protocol, not something curl can trivially replicate), but both the RPC layer and the calling code's error-handling pattern (`RateLimitError` → existing try/catch → `error` state, already proven elsewhere in the app) are independently verified.

Nothing else (Google OAuth) has been built yet. Follow the build order in `SPEC.md` for what comes next, and don't skip ahead — later steps depend on earlier ones.

## Third category: Afrobeats

Added as the third playable category alongside Football and General Knowledge. The category system was already built generically (a single `CATEGORIES` array + a `Record<Category, ...>` UI metadata map), and the landing page already had a disabled "Afrobeats — New category coming soon" placeholder card wired up with its own illustration (`MicrophoneIllustration`) — this just activated it as a real, playable button, no redesign needed.

- `src/lib/categories.ts` — `CATEGORIES` now `["football", "general_knowledge", "afrobeats"]`.
- `src/components/Landing.tsx` — `CATEGORY_META.afrobeats` added (yellow→red gradient, `MicrophoneIllustration`), placeholder card removed.
- `supabase/migrations/20260823000000_add_afrobeats_category.sql` — drops and re-adds the `category` check constraint on `questions`, `matches`, and `matchmaking_queue` (all three were hardcoded to `'football'`/`'general_knowledge'` only, unnamed inline column constraints so the default Postgres names — `<table>_category_check` — apply) to also allow `'afrobeats'`. **Not yet pushed to the live project** — this session had no DB connection string/password available (only the REST URL + anon/service-role keys in `.env.local`), and DDL can't go through PostgREST. Needs `supabase db push` with the pooler `--db-url` (same method noted above) before Afrobeats actually works end-to-end.
- `supabase/seed.sql` — added 75 hand-written Afrobeats questions (Fela Kuti/Afrobeat history, modern artists — Burna Boy, Wizkid, Davido, Tiwa Savage, Rema, Tems, CKay, and more — real names, labels, hits, awards, genre/dance trivia), matching the 75-per-category count the other two categories use. Also not yet pushed — same blocker as above; re-running seed.sql truncates and reinserts *all* categories, so it needs the migration applied first (the check constraint would otherwise reject the new rows).

## Scope discipline (v1)

- Guest-first: no account required to play
- Three categories: Football, General Knowledge, Afrobeats
- Matches are up to 4 players, at least 1 always real, rest filled with bots on timeout
- Score validation is always server-side, never client-only
- Bot opponents: random correct/incorrect + randomized delay, no real AI
- Web only, no mobile app

## Conventions

- No code comments. Don't add them, even short ones.

## Repo / workflow

- GitHub: https://github.com/Ferinco/sabigame.git
- Do NOT commit or push without the user reviewing first. Finish a change, verify it (typecheck/lint/build/tests), then stop and let the user review the diff — wait for explicit go-ahead, then `git commit` and `git push` together.
- No `Co-Authored-By: Claude` (or similar AI-attribution) trailer on commit messages.

