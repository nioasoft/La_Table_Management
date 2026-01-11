import { database } from "@/db";
import {
  user,
  type User,
  type UserRole,
  type UserStatus,
  type UserPermissions,
  DEFAULT_PERMISSIONS,
} from "@/db/schema";
import { eq, desc, and, isNull, isNotNull } from "drizzle-orm";
import {
  logUserApproval,
  logUserSuspension,
  logUserReactivation,
  logPermissionChange,
  type AuditContext,
} from "./auditLog";

/**
 * Get all users from the database
 */
export async function getUsers(): Promise<User[]> {
  return database.select().from(user).orderBy(desc(user.createdAt)) as unknown as Promise<User[]>;
}

/**
 * Find user by ID (alias for getUserById)
 */
export async function findUserById(id: string): Promise<User | null> {
  return getUserById(id);
}

/**
 * Get a single user by ID
 */
export async function getUserById(id: string): Promise<User | null> {
  const results = await database
    .select()
    .from(user)
    .where(eq(user.id, id))
    .limit(1) as unknown as User[];
  return results[0] || null;
}

/**
 * Get a single user by email
 */
export async function getUserByEmail(email: string): Promise<User | null> {
  const results = await database
    .select()
    .from(user)
    .where(eq(user.email, email))
    .limit(1) as unknown as User[];
  return results[0] || null;
}

/**
 * Get all users pending approval
 */
export async function getPendingUsers(): Promise<User[]> {
  return database
    .select()
    .from(user)
    .where(eq(user.status, "pending"))
    .orderBy(desc(user.createdAt)) as unknown as Promise<User[]>;
}

/**
 * Get all active users
 */
export async function getActiveUsers(): Promise<User[]> {
  return database
    .select()
    .from(user)
    .where(eq(user.status, "active"))
    .orderBy(desc(user.createdAt)) as unknown as Promise<User[]>;
}

/**
 * Get users by role
 */
export async function getUsersByRole(role: UserRole): Promise<User[]> {
  return database
    .select()
    .from(user)
    .where(eq(user.role, role))
    .orderBy(desc(user.createdAt)) as unknown as Promise<User[]>;
}

/**
 * Update user status
 */
export async function updateUserStatus(
  userId: string,
  status: UserStatus
): Promise<User | null> {
  const results = await database
    .update(user)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(eq(user.id, userId))
    .returning() as unknown as User[];
  return results[0] || null;
}

/**
 * Update user role
 */
export async function updateUserRole(
  userId: string,
  role: UserRole
): Promise<User | null> {
  const results = await database
    .update(user)
    .set({
      role,
      updatedAt: new Date(),
    })
    .where(eq(user.id, userId))
    .returning() as unknown as User[];
  return results[0] || null;
}

/**
 * Approve a pending user
 * Also creates audit log entry if context provided
 */
export async function approveUser(
  userId: string,
  role: UserRole,
  approvedByUserId: string,
  auditContext?: AuditContext
): Promise<User | null> {
  // Get existing user to capture previous status
  const existingUser = await getUserById(userId);
  const previousStatus = existingUser?.status || "pending";

  const results = await database
    .update(user)
    .set({
      status: "active",
      role,
      approvedBy: approvedByUserId,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(user.id, userId))
    .returning() as unknown as User[];

  const approvedUserResult = results[0] || null;

  // Log to comprehensive audit log if context provided
  if (approvedUserResult && auditContext) {
    await logUserApproval(
      auditContext,
      userId,
      approvedUserResult.name,
      approvedUserResult.email,
      role,
      previousStatus
    );
  }

  return approvedUserResult;
}

/**
 * Suspend a user
 * Also creates audit log entry if context provided
 */
export async function suspendUser(
  userId: string,
  auditContext?: AuditContext,
  reason?: string
): Promise<User | null> {
  // Get existing user to capture previous status
  const existingUser = await getUserById(userId);
  const previousStatus = existingUser?.status || "active";

  const results = await database
    .update(user)
    .set({
      status: "suspended",
      updatedAt: new Date(),
    })
    .where(eq(user.id, userId))
    .returning() as unknown as User[];

  const suspendedUser = results[0] || null;

  // Log to comprehensive audit log if context provided
  if (suspendedUser && auditContext) {
    await logUserSuspension(
      auditContext,
      userId,
      suspendedUser.name,
      previousStatus,
      reason
    );
  }

  return suspendedUser;
}

/**
 * Reactivate a suspended user
 * Also creates audit log entry if context provided
 */
export async function reactivateUser(
  userId: string,
  auditContext?: AuditContext
): Promise<User | null> {
  // Get existing user name
  const existingUser = await getUserById(userId);

  const results = await database
    .update(user)
    .set({
      status: "active",
      updatedAt: new Date(),
    })
    .where(eq(user.id, userId))
    .returning() as unknown as User[];

  const reactivatedUser = results[0] || null;

  // Log to comprehensive audit log if context provided
  if (reactivatedUser && auditContext) {
    await logUserReactivation(auditContext, userId, reactivatedUser.name);
  }

  return reactivatedUser;
}

/**
 * Update user profile
 */
export async function updateUser(
  userId: string,
  data: Partial<{
    name: string;
    email: string;
    image: string;
    role: UserRole;
    status: UserStatus;
  }>
): Promise<User | null> {
  const results = await database
    .update(user)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(user.id, userId))
    .returning() as unknown as User[];
  return results[0] || null;
}

/**
 * Delete a user
 */
export async function deleteUser(userId: string): Promise<boolean> {
  const result = await database.delete(user).where(eq(user.id, userId));
  return (result.rowCount ?? 0) > 0;
}

/**
 * Check if a user is a super user
 */
export async function isSuperUser(userId: string): Promise<boolean> {
  const userData = await getUserById(userId);
  return userData?.role === "super_user";
}

/**
 * Check if a user is an admin or super user
 */
export async function isAdminOrSuperUser(userId: string): Promise<boolean> {
  const userData = await getUserById(userId);
  return userData?.role === "super_user" || userData?.role === "admin";
}

/**
 * Get user statistics for dashboard
 */
export async function getUserStats(): Promise<{
  total: number;
  pending: number;
  active: number;
  suspended: number;
  byRole: Record<UserRole, number>;
}> {
  const allUsers = await getUsers();

  const stats = {
    total: allUsers.length,
    pending: 0,
    active: 0,
    suspended: 0,
    byRole: {
      super_user: 0,
      admin: 0,
      franchisee_owner: 0,
    } as Record<UserRole, number>,
  };

  for (const u of allUsers) {
    // Count by status
    if (u.status === "pending") stats.pending++;
    else if (u.status === "active") stats.active++;
    else if (u.status === "suspended") stats.suspended++;

    // Count by role
    if (u.role) {
      stats.byRole[u.role]++;
    }
  }

  return stats;
}

/**
 * Update user permissions
 * Also creates audit log entry if context provided
 */
export async function updateUserPermissions(
  userId: string,
  permissions: UserPermissions,
  auditContext?: AuditContext,
  reason?: string
): Promise<User | null> {
  // Get existing user to capture previous permissions
  const existingUser = await getUserById(userId);
  const previousPermissions = existingUser?.permissions || null;

  const results = await database
    .update(user)
    .set({
      permissions,
      updatedAt: new Date(),
    })
    .where(eq(user.id, userId))
    .returning() as unknown as User[];

  const updatedUser = results[0] || null;

  // Log to comprehensive audit log if context provided
  if (updatedUser && auditContext) {
    await logPermissionChange(
      auditContext,
      userId,
      updatedUser.name,
      previousPermissions as Record<string, unknown> | null,
      permissions as Record<string, unknown>,
      reason
    );
  }

  return updatedUser;
}

/**
 * Get user permissions with role defaults fallback
 */
export async function getUserPermissions(
  userId: string
): Promise<UserPermissions | null> {
  const userData = await getUserById(userId);
  if (!userData) return null;

  // If user has custom permissions, return them
  if (userData.permissions && Object.keys(userData.permissions).length > 0) {
    return userData.permissions as UserPermissions;
  }

  // Otherwise return role-based defaults
  if (userData.role && DEFAULT_PERMISSIONS[userData.role]) {
    return DEFAULT_PERMISSIONS[userData.role];
  }

  return null;
}

/**
 * Reset user permissions to role defaults
 */
export async function resetUserPermissionsToDefault(
  userId: string
): Promise<User | null> {
  const results = await database
    .update(user)
    .set({
      permissions: null,
      updatedAt: new Date(),
    })
    .where(eq(user.id, userId))
    .returning() as unknown as User[];
  return results[0] || null;
}

/**
 * Approve a user with permissions
 */
export async function approveUserWithPermissions(
  userId: string,
  role: UserRole,
  approvedByUserId: string,
  permissions?: UserPermissions
): Promise<User | null> {
  const results = await database
    .update(user)
    .set({
      status: "active",
      role,
      permissions: permissions || DEFAULT_PERMISSIONS[role],
      approvedBy: approvedByUserId,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(user.id, userId))
    .returning() as unknown as User[];
  return results[0] || null;
}
