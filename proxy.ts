import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { backend } from "@/lib/backend";
import { neonAuth } from "@/lib/neon/auth-server";

export async function proxy(request: NextRequest) {
  if (backend() === "neon") {
    // Session refresh / login redirect is delegated to official Neon Auth.
    // The actual admin permission check always happens in Server Components
    // and Server Actions with a signed JWT + Postgres RLS.
    if (request.nextUrl.pathname.startsWith("/studio")) {
      return neonAuth().middleware({loginUrl:"/login"})(request);
    }
    return NextResponse.next();
  }
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
