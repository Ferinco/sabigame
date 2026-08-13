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
- Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (see `.env.local.example`; actual values go in untracked `.env.local`)
- No Supabase project has been provisioned/linked yet — client code exists but there's no live backend, schema, or seeded data.

## Current state

Steps 1-2 of the SPEC.md build order are done:
1. Project scaffolding + Supabase client wiring.
2. Question bank: `supabase/migrations/20260813000000_create_questions.sql` creates the `questions` table (RLS enabled, public read-only); `supabase/seed.sql` seeds 150 hand-written questions (75 Football, 75 General Knowledge). Uses the local Supabase CLI (`npx supabase ...`) — no Docker in this environment, so migrations/seed have only been validated statically, not run against a live Postgres instance yet.

No Supabase project has been provisioned/linked yet (no `.env.local` credentials, no `supabase link`) — schema and seed data exist as code but nothing has been applied to a real backend.

Nothing else (guest sessions, matchmaking, realtime match loop, bot fallback, result screen, auth/score-locking, leaderboard) has been built yet. Follow the build order in `SPEC.md` for what comes next, and don't skip ahead — later steps depend on earlier ones (e.g. guest sessions before matchmaking).

## Scope discipline (v1)

- Guest-first: no account required to play
- Only 2 categories at launch: Football, General Knowledge
- Score validation is always server-side, never client-only
- Bot opponents: random correct/incorrect + randomized delay, no real AI
- Web only, no mobile app

## Repo / workflow

- GitHub: https://github.com/Ferinco/sabigame.git
- Push after each change (commit + push to `main` once a change is complete and verified).

