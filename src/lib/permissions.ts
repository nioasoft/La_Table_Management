/**
 * Permission checking utilities for module-level granular permissions
 */

import {
  type UserPermissions,
  type SystemModule,
  type PermissionAction,
  type ModulePermission,
  type UserRole,
  DEFAULT_PERMISSIONS,
  SYSTEM_MODULES,
  PERMISSION_ACTIONS,
} from "@/db/schema";

/**
 * Get the effective permissions for a user
 * Falls back to role-based defaults if no custom permissions are set
 */
export function getEffectivePermissions(
  role: UserRole | null | undefined,
  customPermissions: UserPermissions | null | undefined
): UserPermissions {
  // If custom permissions exist, use them
  if (customPermissions && Object.keys(customPermissions).length > 0) {
    return customPermissions;
  }

  // Otherwise, use role-based defaults
  if (role && DEFAULT_PERMISSIONS[role]) {
    return DEFAULT_PERMISSIONS[role];
  }

  // No permissions if no role
  return {};
}

/**
 * Check if a user has a specific permission on a module
 */
export function hasPermission(
  role: UserRole | null | undefined,
  customPermissions: UserPermissions | null | undefined,
  module: SystemModule,
  action: PermissionAction
): boolean {
  const effectivePermissions = getEffectivePermissions(role, customPermissions);
  const modulePermissions = effectivePermissions[module];

  if (!modulePermissions) {
    return false;
  }

  return modulePermissions[action] === true;
}

/**
 * Check if a user can view a module
 */
export function canView(
  role: UserRole | null | undefined,
  customPermissions: UserPermissions | null | undefined,
  module: SystemModule
): boolean {
  return hasPermission(role, customPermissions, module, "view");
}

/**
 * Check if a user can edit in a module
 */
export function canEdit(
  role: UserRole | null | undefined,
  customPermissions: UserPermissions | null | undefined,
  module: SystemModule
): boolean {
  return hasPermission(role, customPermissions, module, "edit");
}

/**
 * Check if a user can create in a module
 */
export function canCreate(
  role: UserRole | null | undefined,
  customPermissions: UserPermissions | null | undefined,
  module: SystemModule
): boolean {
  return hasPermission(role, customPermissions, module, "create");
}

/**
 * Check if a user can delete in a module
 */
export function canDelete(
  role: UserRole | null | undefined,
  customPermissions: UserPermissions | null | undefined,
  module: SystemModule
): boolean {
  return hasPermission(role, customPermissions, module, "delete");
}

/**
 * Check if a user can approve in a module
 */
export function canApprove(
  role: UserRole | null | undefined,
  customPermissions: UserPermissions | null | undefined,
  module: SystemModule
): boolean {
  return hasPermission(role, customPermissions, module, "approve");
}

/**
 * Get all permissions for a specific module
 */
export function getModulePermissions(
  role: UserRole | null | undefined,
  customPermissions: UserPermissions | null | undefined,
  module: SystemModule
): ModulePermission {
  const effectivePermissions = getEffectivePermissions(role, customPermissions);
  return effectivePermissions[module] || {
    view: false,
    edit: false,
    create: false,
    delete: false,
    approve: false,
  };
}

/**
 * Create a full permissions object with all modules set to specified defaults
 */
export function createFullPermissions(
  defaultValue: boolean = false
): UserPermissions {
  const permissions: UserPermissions = {};
  for (const module of SYSTEM_MODULES) {
    permissions[module] = {
      view: defaultValue,
      edit: defaultValue,
      create: defaultValue,
      delete: defaultValue,
      approve: defaultValue,
    };
  }
  return permissions;
}

/**
 * Merge custom permissions with role defaults
 * Custom permissions override role defaults
 */
export function mergePermissions(
  rolePermissions: UserPermissions,
  customPermissions: UserPermissions
): UserPermissions {
  const merged: UserPermissions = { ...rolePermissions };

  for (const module of SYSTEM_MODULES) {
    if (customPermissions[module]) {
      merged[module] = { ...rolePermissions[module], ...customPermissions[module] };
    }
  }

  return merged;
}

/**
 * Validate a permissions object structure
 */
export function validatePermissions(permissions: unknown): permissions is UserPermissions {
  if (!permissions || typeof permissions !== "object") {
    return false;
  }

  const perms = permissions as Record<string, unknown>;

  for (const key of Object.keys(perms)) {
    // Check if key is a valid module
    if (!SYSTEM_MODULES.includes(key as SystemModule)) {
      return false;
    }

    const modulePerms = perms[key];
    if (!modulePerms || typeof modulePerms !== "object") {
      return false;
    }

    // Check if all required permission actions exist
    for (const action of PERMISSION_ACTIONS) {
      if (typeof (modulePerms as Record<string, unknown>)[action] !== "boolean") {
        return false;
      }
    }
  }

  return true;
}

/**
 * Get a human-readable label for a module
 */
export function getModuleLabel(module: SystemModule): string {
  const labels: Record<SystemModule, string> = {
    brands: "Brands",
    suppliers: "Suppliers",
    franchisees: "Franchisees",
    documents: "Documents",
    settlements: "Settlements",
    commissions: "Commissions",
    reminders: "Reminders",
    users: "Users",
    email_templates: "Email Templates",
    management_companies: "Management Companies",
  };
  return labels[module];
}

/**
 * Get a human-readable label for a permission action
 */
export function getActionLabel(action: PermissionAction): string {
  const labels: Record<PermissionAction, string> = {
    view: "View",
    edit: "Edit",
    create: "Create",
    delete: "Delete",
    approve: "Approve",
  };
  return labels[action];
}

// Re-export types and constants for convenience
export {
  type UserPermissions,
  type SystemModule,
  type PermissionAction,
  type ModulePermission,
  SYSTEM_MODULES,
  PERMISSION_ACTIONS,
  DEFAULT_PERMISSIONS,
};
