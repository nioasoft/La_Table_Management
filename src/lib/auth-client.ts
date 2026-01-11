import { createAuthClient } from "better-auth/react";
import type { UserRole, UserStatus } from "@/db/schema";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL || "http://localhost:3000",
});

// Extended user type with role and status
export interface ExtendedUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string;
  role?: UserRole;
  status?: UserStatus;
  approvedBy?: string;
  approvedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

// Export hooks for convenience
export const { useSession, signIn, signUp, signOut } = authClient;
