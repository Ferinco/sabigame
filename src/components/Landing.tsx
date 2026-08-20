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
import { BrainIllustration, FootballIllustration, MicrophoneIllustration } from "@/components/Illustrations";

const CATEGORY_META: Record<
  Category,
  { label: string; Icon: (props: { className?: string }) => React.JSX.Element; from: string; to: string }
> = {
  football: { label: "Football", Icon: FootballIllustration, from: "from-accent-green", to: "to-accent-blue" },
  general_knowledge: {
    label: "General Knowledge",
    Icon: BrainIllustration,
    from: "from-brand",
    to: "to-accent-red",
  },
  afrobeats: {
    label: "Afrobeats",
    Icon: MicrophoneIllustration,
    from: "from-accent-yellow",
    to: "to-accent-red",
  },
};

function Blobs() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="animate-blob absolute -left-16 -top-16 h-64 w-64 rounded-full bg-accent-yellow/40 blur-2xl" />
      <div
        className="animate-blob absolute -right-10 top-24 h-72 w-72 rounded-full bg-brand/30 blur-2xl"
        style={{ animationDelay: "2s" }}
      />
      <div
        className="animate-blob absolute bottom-0 left-1/3 h-56 w-56 rounded-full bg-accent-green/30 blur-2xl"
        style={{ animationDelay: "4s" }}
      />
    </div>
  );
}

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
      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-background">
        <Blobs />
        <main className="animate-pop-in relative z-10 flex w-full max-w-sm flex-col items-center gap-8 px-6 py-24">
          <div className="flex flex-col items-center gap-2 text-center">
            <span className="text-5xl">🎉</span>
            <h1 className="font-display text-4xl font-extrabold tracking-tight text-foreground">
              SabiGame
            </h1>
            <p className="text-muted">What should we call you?</p>
          </div>
          <form onSubmit={handleNicknameSubmit} className="flex w-full flex-col gap-3">
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Enter a nickname"
              maxLength={20}
              autoFocus
              className="w-full rounded-2xl border-2 border-card-border bg-card px-5 py-3.5 text-foreground outline-none transition-colors focus:border-brand"
            />
            <button
              type="submit"
              disabled={savingNickname || nickname.trim().length === 0}
              className="w-full rounded-2xl bg-brand px-5 py-3.5 font-display text-lg font-bold text-white shadow-lg shadow-brand/30 transition-all hover:scale-[1.02] hover:bg-brand-dark active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
            >
              Let&apos;s go →
            </button>
            {nicknameError && <p className="text-sm text-accent-red">{nicknameError}</p>}
          </form>
        </main>
      </div>
    );
  }

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-background">
      <Blobs />
      <main className="animate-pop-in relative z-10 flex w-full max-w-sm flex-col items-center gap-8 px-6 py-24">
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="font-display text-4xl font-extrabold tracking-tight text-foreground">
            SabiGame
          </h1>
          {status !== "waiting" && (
            <p className="text-sm text-muted">
              Playing as <span className="font-semibold text-foreground">{nickname}</span>{" "}
              <button onClick={() => setNicknameConfirmed(false)} className="underline">
                change
              </button>
            </p>
          )}
        </div>

        {status === "waiting" ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <span className="animate-wiggle text-5xl" style={{ animationIterationCount: "infinite" }}>
              🔎
            </span>
            <p className="font-display text-lg font-semibold text-foreground">
              Finding you opponents…
            </p>
          </div>
        ) : (
          <div className="flex w-full flex-col gap-3">
            {CATEGORIES.map((category) => {
              const meta = CATEGORY_META[category];
              const Icon = meta.Icon;
              return (
                <button
                  key={category}
                  onClick={() => handleFindMatch(category)}
                  className={`flex w-full items-center gap-3 rounded-2xl bg-gradient-to-br ${meta.from} ${meta.to} px-5 py-4 text-left font-display text-lg font-bold text-white shadow-lg transition-all hover:scale-[1.02] active:scale-95`}
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/25 text-white">
                    <Icon className="h-7 w-7" />
                  </span>
                  {meta.label}
                </button>
              );
            })}
          </div>
        )}

        {error && <p className="text-sm text-accent-red">{error}</p>}

        <Link href="/leaderboard" className="text-sm font-semibold text-muted underline underline-offset-4">
          🏆 Leaderboard
        </Link>
      </main>
    </div>
  );
}
