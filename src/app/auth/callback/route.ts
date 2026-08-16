import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGuestId } from "@/lib/guest/session";
import { lockMatchScore } from "@/lib/match/lock-score";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const matchId = searchParams.get("matchId");
  const redirectTo = matchId ? `${origin}/match/${matchId}` : origin;

  if (!code) {
    return NextResponse.redirect(redirectTo);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${redirectTo}?lockError=1`);
  }

  if (matchId) {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const guestId = await getGuestId();
      await lockMatchScore(matchId, guestId, user.id);
    }
  }

  return NextResponse.redirect(redirectTo);
}
