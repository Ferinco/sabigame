import Link from "next/link";
import { getLeaderboard } from "@/lib/leaderboard/actions";

export default async function LeaderboardPage() {
  const entries = await getLeaderboard();

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-black">
      <main className="flex w-full max-w-sm flex-col items-center gap-6 px-6 py-24">
        <h1 className="text-3xl font-bold tracking-tight text-black dark:text-zinc-50">
          Leaderboard
        </h1>

        {entries.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">
            No locked scores yet — be the first to join the global ranking.
          </p>
        ) : (
          <ol className="flex w-full flex-col gap-2">
            {entries.map((entry, i) => (
              <li
                key={entry.playerId}
                className="flex items-center justify-between rounded-lg border border-black/[.08] bg-white px-4 py-2 dark:border-white/[.145] dark:bg-zinc-900"
              >
                <span>
                  {i + 1}. {entry.nickname ?? "Player"}
                </span>
                <span className="font-semibold">{entry.totalScore}</span>
              </li>
            ))}
          </ol>
        )}

        <Link href="/" className="text-sm underline text-zinc-600 dark:text-zinc-400">
          Back to SabiGame
        </Link>
      </main>
    </div>
  );
}
