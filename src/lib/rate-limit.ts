import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export class RateLimitError extends Error {
  constructor() {
    super("Too many requests — slow down and try again in a moment.");
    this.name = "RateLimitError";
  }
}

export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<void> {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("check_rate_limit", {
    p_key: key,
    p_max_requests: maxRequests,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    throw new Error(`Failed to check rate limit: ${error.message}`);
  }

  if (!data) {
    throw new RateLimitError();
  }
}
