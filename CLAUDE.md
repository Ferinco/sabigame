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
- `src/lib/supabase/middleware.ts` + root `middleware.ts` — refreshes the auth session on every request
- `src/lib/supabase/admin.ts` — service-role client, server-only, bypasses RLS (used for writes like `guest_sessions` that anon policies intentionally don't allow)
- Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (see `.env.local.example`; actual values go in untracked `.env.local`)
- Supabase project URL + anon key are live in `.env.local`. `SUPABASE_SERVICE_ROLE_KEY` is still a placeholder — `ensureGuestSession` (called from root layout) will throw / 500 until the real key is dropped in.
- Migrations have not been applied to the live project yet (no `supabase link` / `db push` run) — schema exists as code only so far.

## Guest sessions

- `src/lib/guest/constants.ts` — cookie name (`sabigame_guest_id`) + max-age
- `src/lib/guest/middleware.ts` — `ensureGuestId(request)`, called from root `middleware.ts`; generates a UUID via `crypto.randomUUID()` if the cookie's missing, mutates `request.cookies` so Server Components see it on the same request, and the response cookie is set for the browser to persist it (1yr, `sameSite: lax`)
- `src/lib/guest/session.ts` — server-only helpers: `getGuestId()` (reads the cookie), `ensureGuestSession(guestId)` (upserts a `guest_sessions` row, no-op if it exists — called from root layout on every request), `setGuestNickname(guestId, nickname)` (not wired to UI yet — landing page nickname form is future work)
- `supabase/migrations/20260814000000_create_guest_sessions.sql` — `guest_sessions` table, RLS on with zero anon/authenticated policies (guests aren't Supabase Auth users, so writes only ever go through the service-role client server-side)

## Current state

Steps 1-3 of the SPEC.md build order are done:
1. Project scaffolding + Supabase client wiring.
2. Question bank: `supabase/migrations/20260813000000_create_questions.sql` creates the `questions` table (RLS enabled, public read-only); `supabase/seed.sql` seeds 150 hand-written questions (75 Football, 75 General Knowledge).
3. Guest session handling — see above.

Migrations/seed have only been validated statically (parsed for structural correctness), not run against a live Postgres instance — no Docker in this environment, so no local Supabase stack. They still need to be applied to the live project (`supabase link` + `supabase db push`, or run by hand in the SQL editor).

Nothing else (matchmaking, realtime match loop, bot fallback, result screen, auth/score-locking, leaderboard) has been built yet. Follow the build order in `SPEC.md` for what comes next, and don't skip ahead — later steps depend on earlier ones.

## Scope discipline (v1)

- Guest-first: no account required to play
- Only 2 categories at launch: Football, General Knowledge
- Score validation is always server-side, never client-only
- Bot opponents: random correct/incorrect + randomized delay, no real AI
- Web only, no mobile app

## Repo / workflow

- GitHub: https://github.com/Ferinco/sabigame.git
- Push after each change (commit + push to `main` once a change is complete and verified).

