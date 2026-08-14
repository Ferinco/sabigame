# SabiGame — Project Spec

## What it is

A web-based, no-download trivia game. Players pick a category, get grouped into a match of up to **4 players**, and race to answer rapid-fire questions. First to tap the correct answer each round gets the point.

## Core flow

1. Land on site → enter a nickname → pick a category (start with **Football** and **General Knowledge**)
2. Hit "Find Match" → join a matchmaking queue for that category
3. Queue gathers up to **4 players** for that category. If fewer than 4 are waiting after ~15-20 seconds, the match starts anyway with whoever's there, filling remaining seats with bots (randomized correct/incorrect answers with a randomized delay) so it always starts with 4 total. At least 1 real player is always required — this happens automatically, since the fallback only ever runs because a real player is waiting.
4. Match starts: all players see the same question + 4 options at the same instant (server-timestamped, so it's fair regardless of network latency)
5. First correct answer wins the point; question immediately refreshes
6. Each question has its own short countdown (a few seconds). There is no overall match timer — the match ends after a fixed number of questions (e.g. 10), not elapsed time. A question nobody answers correctly in time just advances with no one scoring it.
7. Result screen: ranked list (1st-4th place) by final score, "Rematch" or "New Match" buttons
8. New option on result screen: **"Lock this score & join global ranking"** → prompts signup (magic link or Google OAuth) → migrates this guest's `match_results` row onto their new account

## Tech stack

- **Framework**: Next.js (App Router), TypeScript
- **Backend/DB/Realtime/Auth**: Supabase (Postgres + Realtime channels + Auth)
- **Hosting**: Vercel (app), Supabase Cloud (backend)
- **Styling**: Tailwind CSS

## Data model (rough)

- `questions` — id, category, question text, options (array), correct_answer_index
- `guest_sessions` — anonymous_id (UUID, cookie-based), nickname, created_at
- `matches` — id, category, started_at, ended_at, question_count, question_duration_ms (up to 4 participants — see `match_results`, not fixed player_1/player_2 columns)
- `match_results` — match_id, player_id (guest anonymous_id OR user_id), is_bot, score, is_locked (bool). Doubles as the match's participant roster and live scoreboard, not just a post-match summary.
- `match_rounds` — match_id, round_number, question_id/text/options (denormalized, no answer), started_at, expires_at, winner_guest_id, answered_at
- `users` — standard Supabase auth users table, linked to match_results after "lock score" signup

## Build order (do in this sequence)

1. **Scaffold the Next.js + Tailwind project**, set up Supabase client
2. **Question bank**: seed `questions` table with ~100-150 hand-written questions across the 2 starting categories
3. **Guest session handling**: generate + persist an anonymous UUID per visitor (cookie or localStorage) before anything else
4. **Matchmaking queue**: category-scoped queue table/logic — gather up to 4 guests waiting in the same category into a `match`
5. **Real-time match loop**: Supabase Realtime channel per match; server broadcasts question + a per-question countdown, all clients render simultaneously, first correct answer (validated server-side, not just client-side) scores the point. Match ends after a fixed number of questions, not elapsed time.
6. **Bot fallback**: if queue wait exceeds ~15-20s, fill remaining seats (up to 4 total) with bots instead of leaving players waiting — at least 1 real player is always required to start a match
7. **Result screen + rematch/new match loop**: ranked list (1st-4th) by final score
8. **"Lock score" flow**: Supabase Auth (magic link or Google OAuth) + migration of the guest's `match_results` row onto the new authenticated user_id
9. **Global leaderboard page** (once locking is working)

## Scope discipline for v1 — explicitly SKIP these for now

- No persistent accounts required to just play (guest-first, always)
- No more than 2 categories at launch
- No client-side-only score validation — always verify server-side to prevent cheating
- No elaborate bot AI — random correct/incorrect + randomized delay is enough
- No mobile app — web only, this is the whole point (no-install, link-and-play)

## Repo

- GitHub: https://github.com/Ferinco/sabigame.git
- Push after each change.
