import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { backend } from "@/lib/backend";
import { neonAuth } from "@/lib/neon/auth-server";

export async function proxy(request: NextRequest) {
  let response: NextResponse;
  if (backend() === "neon") {
    // Session refresh / login redirect is delegated to official Neon Auth.
    // The actual admin permission check always happens in Server Components
    // and Server Actions with a signed JWT + Postgres RLS.
    response = request.nextUrl.pathname.startsWith("/studio")
      ? await neonAuth().middleware({loginUrl:"/login"})(request)
      : NextResponse.next();
  } else {
    response = await updateSession(request);
  }
  if (request.nextUrl.pathname === "/reset-password") {
    // The short-lived recovery token arrives in a callback query string.
    // Never cache that page or send its URL in a referrer to other sites.
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("Referrer-Policy", "no-referrer");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
