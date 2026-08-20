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
    <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="animate-blob absolute -left-16 -top-16 h-64 w-64 rounded-full bg-brand/30 blur-2xl" />
        <div
          className="animate-blob absolute -right-10 bottom-10 h-72 w-72 rounded-full bg-accent-yellow/40 blur-2xl"
          style={{ animationDelay: "2s" }}
        />
      </div>

      <main className="animate-pop-in relative z-10 flex w-full max-w-sm flex-col items-center gap-6 px-6 py-24">
        <span className="text-5xl">🔒</span>
        <h1 className="text-center font-display text-2xl font-extrabold text-foreground">
          Lock this score & join global ranking
        </h1>

        {status === "sent" ? (
          <div className="animate-bounce-in flex flex-col items-center gap-2 text-center">
            <span className="text-4xl">📬</span>
            <p className="font-semibold text-foreground">Check your email</p>
            <p className="text-sm text-muted">We sent a magic link to lock this score in.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Your email"
              required
              autoFocus
              className="w-full rounded-2xl border-2 border-card-border bg-card px-5 py-3.5 text-foreground outline-none transition-colors focus:border-brand"
            />
            <button
              type="submit"
              disabled={status === "sending"}
              className="w-full rounded-2xl bg-brand px-5 py-3.5 font-display text-lg font-bold text-white shadow-lg shadow-brand/30 transition-all hover:scale-[1.02] hover:bg-brand-dark active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
            >
              {status === "sending" ? "Sending…" : "Send magic link ✨"}
            </button>
            {error && <p className="text-sm text-accent-red">{error}</p>}
          </form>
        )}

        <Link href={`/match/${matchId}`} className="text-sm font-semibold text-muted underline underline-offset-4">
          ← Back to results
        </Link>
      </main>
    </div>
  );
}
