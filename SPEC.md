# SabiGame — Project Spec

## What it is

A web-based, no-download trivia game. Players pick a category, get randomly paired with an opponent, and race to answer rapid-fire questions for 15 seconds. First to tap the correct answer each round gets the point.

## Core flow

1. Land on site → enter a nickname → pick a category (start with **Football** and **General Knowledge**)
2. Hit "Find Match" → join a matchmaking queue for that category
3. If no real opponent found within ~15-20 seconds → paired with a bot (randomized correct/incorrect answers with a randomized delay)
4. Match starts: both players see the same question + 4 options at the same instant (server-timestamped, so it's fair regardless of network latency)
5. First correct answer wins the point; question immediately refreshes
6. Repeats for 15 seconds total
7. Result screen: final score, "Rematch" or "New Match" buttons
8. New option on result screen: **"Lock this score & join global ranking"** → prompts signup (magic link or Google OAuth) → migrates this guest match onto their new account

## Tech stack

- **Framework**: Next.js (App Router), TypeScript
- **Backend/DB/Realtime/Auth**: Supabase (Postgres + Realtime channels + Auth)
- **Hosting**: Vercel (app), Supabase Cloud (backend)
- **Styling**: Tailwind CSS

## Data model (rough)

- `questions` — id, category, question text, options (array), correct_answer_index
- `guest_sessions` — anonymous_id (UUID, cookie-based), nickname, created_at
- `matches` — id, category, player_1_id, player_2_id (nullable if bot), started_at, ended_at
- `match_results` — match_id, player_id (guest anonymous_id OR user_id), score, is_locked (bool)
- `users` — standard Supabase auth users table, linked to match_results after "lock score" signup

## Build order (do in this sequence)

1. **Scaffold the Next.js + Tailwind project**, set up Supabase client
2. **Question bank**: seed `questions` table with ~100-150 hand-written questions across the 2 starting categories
3. **Guest session handling**: generate + persist an anonymous UUID per visitor (cookie or localStorage) before anything else
4. **Matchmaking queue**: category-scoped queue table/logic — when 2 guests are waiting in the same category, pair them into a `match`
5. **Real-time match loop**: Supabase Realtime channel per match; server broadcasts question + timestamp, both clients render simultaneously, first correct answer (validated server-side, not just client-side) scores the point
6. **Bot fallback**: if queue wait exceeds ~15-20s, spin up a bot opponent instead of leaving the player waiting
7. **Result screen + rematch/new match loop**
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
