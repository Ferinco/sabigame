import { NextResponse, type NextRequest } from "next/server";
import { refreshSupabaseSession } from "@/lib/supabase/middleware";
import {
  GUEST_ID_COOKIE,
  GUEST_ID_HEADER,
  GUEST_ID_COOKIE_MAX_AGE,
} from "@/lib/guest/constants";

export async function proxy(request: NextRequest) {
  const existingGuestId = request.cookies.get(GUEST_ID_COOKIE)?.value;
  const guestId = existingGuestId ?? crypto.randomUUID();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(GUEST_ID_HEADER, guestId);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  await refreshSupabaseSession(request, response);

  if (!existingGuestId) {
    response.cookies.set(GUEST_ID_COOKIE, guestId, {
      maxAge: GUEST_ID_COOKIE_MAX_AGE,
      path: "/",
      sameSite: "lax",
    });
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
