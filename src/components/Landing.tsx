"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  joinMatchmakingQueue,
  checkMatchmakingStatus,
  leaveMatchmakingQueue,
} from "@/lib/matchmaking/actions";
import { submitNickname } from "@/lib/guest/actions";
import { CATEGORIES, type Category } from "@/lib/categories";

const CATEGORY_LABELS: Record<Category, string> = {
  football: "Football",
  general_knowledge: "General Knowledge",
};

export function Landing({ initialNickname }: { initialNickname: string | null }) {
  const router = useRouter();
  const [nickname, setNickname] = useState(initialNickname ?? "");
  const [nicknameConfirmed, setNicknameConfirmed] = useState(Boolean(initialNickname));
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [savingNickname, setSavingNickname] = useState(false);
  const [status, setStatus] = useState<"idle" | "waiting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (status === "waiting") {
        leaveMatchmakingQueue().catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleNicknameSubmit(e: React.FormEvent) {
    e.preventDefault();
    setNicknameError(null);
    setSavingNickname(true);

    try {
      const result = await submitNickname(nickname);
      if (!result.ok) {
        setNicknameError(result.error);
        return;
      }
      setNicknameConfirmed(true);
    } finally {
      setSavingNickname(false);
    }
  }

  async function handleFindMatch(category: Category) {
    setError(null);
    setStatus("waiting");

    try {
      const result = await joinMatchmakingQueue(category);

      if (result.status === "matched") {
        router.push(`/match/${result.matchId}`);
        return;
      }

      pollRef.current = setInterval(async () => {
        const poll = await checkMatchmakingStatus();
        if (poll.status === "matched") {
          if (pollRef.current) clearInterval(pollRef.current);
          router.push(`/match/${poll.matchId}`);
        }
      }, 2000);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  if (!nicknameConfirmed) {
    return (
      <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-black">
        <main className="flex w-full max-w-sm flex-col items-center gap-8 px-6 py-24">
          <h1 className="text-3xl font-bold tracking-tight text-black dark:text-zinc-50">
            SabiGame
          </h1>
          <form onSubmit={handleNicknameSubmit} className="flex w-full flex-col gap-3">
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Enter a nickname"
              maxLength={20}
              autoFocus
              className="w-full rounded-full border border-black/[.08] bg-white px-5 py-3 text-black outline-none focus:border-black/[.24] dark:border-white/[.145] dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-white/[.3]"
            />
            <button
              type="submit"
              disabled={savingNickname || nickname.trim().length === 0}
              className="w-full rounded-full bg-foreground px-5 py-3 text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
            >
              Continue
            </button>
            {nicknameError && <p className="text-sm text-red-600">{nicknameError}</p>}
          </form>
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-black">
      <main className="flex w-full max-w-sm flex-col items-center gap-8 px-6 py-24">
        <div className="flex flex-col items-center gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-black dark:text-zinc-50">
            SabiGame
          </h1>
          {status !== "waiting" && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Playing as {nickname}{" "}
              <button onClick={() => setNicknameConfirmed(false)} className="underline">
                change
              </button>
            </p>
          )}
        </div>

        {status === "waiting" ? (
          <p className="text-zinc-600 dark:text-zinc-400">Finding you an opponent…</p>
        ) : (
          <div className="flex w-full flex-col gap-3">
            {CATEGORIES.map((category) => (
              <button
                key={category}
                onClick={() => handleFindMatch(category)}
                className="w-full rounded-full bg-foreground px-5 py-3 text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
              >
                {CATEGORY_LABELS[category]}
              </button>
            ))}
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <Link href="/leaderboard" className="text-sm underline text-zinc-600 dark:text-zinc-400">
          Leaderboard
        </Link>
      </main>
    </div>
  );
}
