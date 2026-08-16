"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export function LockScoreForm({ matchId }: { matchId: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus("sending");

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?matchId=${matchId}`,
        },
      });

      if (error) {
        setStatus("error");
        setError(error.message);
        return;
      }

      setStatus("sent");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-black">
      <main className="flex w-full max-w-sm flex-col items-center gap-6 px-6 py-24">
        <h1 className="text-2xl font-bold text-black dark:text-zinc-50">
          Lock this score & join global ranking
        </h1>

        {status === "sent" ? (
          <p className="text-sm text-zinc-500">
            Check your email for a magic link to lock this score.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Your email"
              required
              autoFocus
              className="w-full rounded-full border border-black/[.08] bg-white px-5 py-3 text-black outline-none focus:border-black/[.24] dark:border-white/[.145] dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-white/[.3]"
            />
            <button
              type="submit"
              disabled={status === "sending"}
              className="w-full rounded-full bg-foreground px-5 py-3 text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
            >
              Send magic link
            </button>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </form>
        )}

        <Link href={`/match/${matchId}`} className="text-sm underline text-zinc-600 dark:text-zinc-400">
          Back to results
        </Link>
      </main>
    </div>
  );
}
