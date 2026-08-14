"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  joinMatchmakingQueue,
  checkMatchmakingStatus,
  leaveMatchmakingQueue,
} from "@/lib/matchmaking/actions";
import { CATEGORIES, type Category } from "@/lib/categories";

const CATEGORY_LABELS: Record<Category, string> = {
  football: "Football",
  general_knowledge: "General Knowledge",
};

export default function Home() {
  const router = useRouter();
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

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-black">
      <main className="flex w-full max-w-sm flex-col items-center gap-8 px-6 py-24">
        <h1 className="text-3xl font-bold tracking-tight text-black dark:text-zinc-50">
          SabiGame
        </h1>

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
      </main>
    </div>
  );
}
