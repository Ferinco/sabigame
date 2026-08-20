import Link from "next/link";
import { getLeaderboard } from "@/lib/leaderboard/actions";
import { MEDALS, AVATAR_COLORS } from "@/lib/ui/podium";

export default async function LeaderboardPage() {
  const entries = await getLeaderboard();

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="animate-blob absolute -left-16 -top-16 h-64 w-64 rounded-full bg-accent-yellow/40 blur-2xl" />
        <div
          className="animate-blob absolute -right-10 top-24 h-72 w-72 rounded-full bg-brand/30 blur-2xl"
          style={{ animationDelay: "2s" }}
        />
      </div>

      <main className="animate-pop-in relative z-10 flex w-full max-w-sm flex-col items-center gap-6 px-6 py-24">
        <span className="text-5xl">🏆</span>
        <h1 className="font-display text-4xl font-extrabold tracking-tight text-foreground">
          Leaderboard
        </h1>

        {entries.length === 0 ? (
          <p className="text-center text-muted">
            No locked scores yet — be the first to join the global ranking.
          </p>
        ) : (
          <ol className="flex w-full flex-col gap-2">
            {entries.map((entry, i) => (
              <li
                key={entry.playerId}
                className="animate-bounce-in flex items-center gap-3 rounded-2xl border-2 border-card-border bg-card px-4 py-3 shadow-sm"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <span className="w-7 text-center text-xl">{MEDALS[i] ?? `${i + 1}.`}</span>
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${AVATAR_COLORS[i % AVATAR_COLORS.length]}`}
                >
                  {(entry.nickname ?? "Player").charAt(0).toUpperCase()}
                </span>
                <span className="flex-1 font-semibold text-foreground">
                  {entry.nickname ?? "Player"}
                </span>
                <span className="font-display text-lg font-extrabold text-brand">
                  {entry.totalScore}
                </span>
              </li>
            ))}
          </ol>
        )}

        <Link href="/" className="text-sm font-semibold text-muted underline underline-offset-4">
          ← Back to SabiGame
        </Link>
      </main>
    </div>
  );
}
