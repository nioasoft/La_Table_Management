import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  checkRateLimit,
  getClientIP,
  RateLimitConfigs,
  createRateLimitHeaders,
} from "@/lib/rate-limit";

// Define protected routes and their required roles
const protectedRoutes = {
  "/dashboard": ["super_user", "admin", "franchisee_owner"],
  "/admin": ["super_user", "admin"],
  "/admin/users": ["super_user", "admin"],
};

// Auth routes that should redirect to dashboard if already authenticated
const authRoutes = ["/sign-in", "/sign-up"];

// Rate-limited API routes with their configurations
const rateLimitedRoutes: Array<{
  pattern: RegExp;
  config: { limit: number; windowSeconds: number };
}> = [
  { pattern: /^\/api\/auth/, config: RateLimitConfigs.auth },
  { pattern: /^\/api\/public\/upload/, config: RateLimitConfigs.upload },
  { pattern: /^\/api\/cron/, config: RateLimitConfigs.cron },
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check rate limiting for API routes
  for (const { pattern, config } of rateLimitedRoutes) {
    if (pattern.test(pathname)) {
      const ip = getClientIP(request);
      const result = checkRateLimit(`${ip}:${pathname}`, config);

      if (!result.success) {
        const headers = createRateLimitHeaders(result);
        return new NextResponse(
          JSON.stringify({
            error: "Too many requests",
            retryAfter: Math.ceil((result.reset - Date.now()) / 1000),
          }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              ...Object.fromEntries(headers),
            },
          }
        );
      }
      break; // Only apply first matching rate limit
    }
  }

  // Check if this is an auth route
  const isAuthRoute = authRoutes.some((route) => pathname.startsWith(route));

  // Get session token from cookie (Better Auth uses this name)
  const sessionToken = request.cookies.get("better-auth.session_token")?.value
    || request.cookies.get("__Secure-better-auth.session_token")?.value;

  // If accessing auth routes and has session, redirect to dashboard
  if (isAuthRoute && sessionToken) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Check if this is a protected route
  const isProtectedRoute = Object.keys(protectedRoutes).some((route) =>
    pathname.startsWith(route)
  );

  // If accessing protected routes without session, redirect to sign-in
  if (isProtectedRoute && !sessionToken) {
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(signInUrl);
  }

  // Note: Role-based access control is handled in the individual pages/API routes
  // because middleware cannot easily access the session data
  // The individual pages check the user's role and redirect accordingly

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for static files:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     *
     * Note: api/auth, api/public, api/cron are now included for rate limiting,
     * but they still skip session-based auth checks (handled in middleware logic)
     */
    "/((?!_next/static|_next/image|favicon.ico|public).*)",
  ],
};
