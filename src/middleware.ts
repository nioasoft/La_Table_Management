import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Define protected routes and their required roles
const protectedRoutes = {
  "/dashboard": ["super_user", "admin", "franchisee_owner"],
  "/admin": ["super_user", "admin"],
  "/admin/users": ["super_user", "admin"],
};

// Auth routes that should redirect to dashboard if already authenticated
const authRoutes = ["/sign-in", "/sign-up"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check if this is an auth route
  const isAuthRoute = authRoutes.some((route) => pathname.startsWith(route));

  // Get session token from cookie
  const sessionToken = request.cookies.get("better-auth.session_token")?.value;

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
     * Match all request paths except for the ones starting with:
     * - api/auth (auth API routes)
     * - api/public (public API routes - no auth required)
     * - upload (public upload pages - no auth required)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    "/((?!api/auth|api/public|upload|_next/static|_next/image|favicon.ico|public).*)",
  ],
};
