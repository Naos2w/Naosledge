import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { backend } from "@/lib/backend";
import { neonAuth } from "@/lib/neon/auth-server";

export async function proxy(request: NextRequest) {
  // A manual deployment of this owner-onboarding branch must not expose the
  // regular public blog, Studio, Vault or any other app routes. It is a
  // temporary managed-Auth-only site, not a site release or Production deploy.
  if (process.env.VERCEL_ENV === "preview" &&
      process.env.VERCEL_GIT_COMMIT_REF === "feat/owner-activation-20261017" &&
      !request.nextUrl.pathname.startsWith("/owner-activation")) {
    return new NextResponse(null,{status:404,headers:{
      "Cache-Control":"private, no-store, max-age=0",
      "Referrer-Policy":"no-referrer",
      "X-Robots-Tag":"noindex, nofollow, noarchive",
    }});
  }
  if (request.nextUrl.pathname.startsWith("/owner-activation")) {
    // Activation is an isolated managed-Auth workflow. Do NOT use either the
    // Supabase session refresher or the Sandbox Neon backend on these routes.
    // Prevent leaking one-time reset URLs through caches, referers or indexes.
    const isolated = NextResponse.next();
    isolated.headers.set("Cache-Control","private, no-store, max-age=0");
    isolated.headers.set("Referrer-Policy","no-referrer");
    isolated.headers.set("X-Robots-Tag","noindex, nofollow, noarchive");
    return isolated;
  }
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
