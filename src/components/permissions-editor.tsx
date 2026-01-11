"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, RotateCcw, Save, Settings } from "lucide-react";
import {
  type UserPermissions,
  type SystemModule,
  type PermissionAction,
  type ModulePermission,
  type UserRole,
  SYSTEM_MODULES,
  PERMISSION_ACTIONS,
  DEFAULT_PERMISSIONS,
} from "@/db/schema";
import { he } from "@/lib/translations/he";

interface PermissionsEditorProps {
  userId: string;
  userName: string;
  userRole: UserRole | null;
  isOpen: boolean;
  onClose: () => void;
  onSave?: () => void;
}

// Hebrew translations for the component
const t = he.components.permissionsEditor;

const MODULE_LABELS: Record<SystemModule, string> = {
  brands: t.modules.brands,
  suppliers: t.modules.suppliers,
  franchisees: t.modules.franchisees,
  documents: t.modules.documents,
  settlements: t.modules.settlements,
  commissions: t.modules.commissions,
  reminders: t.modules.reminders,
  users: t.modules.users,
  email_templates: t.modules.email_templates,
  management_companies: t.modules.management_companies,
};

const ACTION_LABELS: Record<PermissionAction, string> = {
  view: t.actions.view,
  edit: t.actions.edit,
  create: t.actions.create,
  delete: t.actions.delete,
  approve: t.actions.approve,
};

export function PermissionsEditor({
  userId,
  userName,
  userRole,
  isOpen,
  onClose,
  onSave,
}: PermissionsEditorProps) {
  const [permissions, setPermissions] = useState<UserPermissions>({});
  const [originalPermissions, setOriginalPermissions] =
    useState<UserPermissions>({});
  const [hasCustomPermissions, setHasCustomPermissions] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && userId) {
      fetchPermissions();
    }
  }, [isOpen, userId]);

  const fetchPermissions = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await fetch(`/api/users/${userId}/permissions`);
      if (!response.ok) {
        throw new Error(t.errors.loadFailed);
      }
      const data = await response.json();
      const perms = data.permissions || getDefaultPermissions();
      setPermissions(perms);
      setOriginalPermissions(perms);
      setHasCustomPermissions(data.hasCustomPermissions);
    } catch (error) {
      console.error("Error fetching permissions:", error);
      setError(t.errors.loadFailed);
      // Initialize with defaults
      const defaultPerms = getDefaultPermissions();
      setPermissions(defaultPerms);
      setOriginalPermissions(defaultPerms);
    } finally {
      setIsLoading(false);
    }
  };

  const getDefaultPermissions = (): UserPermissions => {
    if (userRole && DEFAULT_PERMISSIONS[userRole]) {
      return JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS[userRole]));
    }
    // Return all false if no role
    const empty: UserPermissions = {};
    for (const module of SYSTEM_MODULES) {
      empty[module] = {
        view: false,
        edit: false,
        create: false,
        delete: false,
        approve: false,
      };
    }
    return empty;
  };

  const handlePermissionChange = (
    module: SystemModule,
    action: PermissionAction,
    checked: boolean
  ) => {
    setPermissions((prev) => ({
      ...prev,
      [module]: {
        ...(prev[module] || {
          view: false,
          edit: false,
          create: false,
          delete: false,
          approve: false,
        }),
        [action]: checked,
      },
    }));
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      setError(null);
      const response = await fetch(`/api/users/${userId}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || t.errors.saveFailed);
      }

      setHasCustomPermissions(true);
      setOriginalPermissions(permissions);
      onSave?.();
      onClose();
    } catch (error) {
      console.error("Error saving permissions:", error);
      setError(
        error instanceof Error ? error.message : t.errors.saveFailed
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    if (
      !confirm(t.confirmReset)
    ) {
      return;
    }

    try {
      setIsResetting(true);
      setError(null);
      const response = await fetch(`/api/users/${userId}/permissions`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || t.errors.resetFailed);
      }

      const data = await response.json();
      const newPerms = data.permissions || getDefaultPermissions();
      setPermissions(newPerms);
      setOriginalPermissions(newPerms);
      setHasCustomPermissions(false);
      onSave?.();
    } catch (error) {
      console.error("Error resetting permissions:", error);
      setError(
        error instanceof Error ? error.message : t.errors.resetFailed
      );
    } finally {
      setIsResetting(false);
    }
  };

  const hasChanges = JSON.stringify(permissions) !== JSON.stringify(originalPermissions);

  const getModulePermission = (
    module: SystemModule,
    action: PermissionAction
  ): boolean => {
    return permissions[module]?.[action] ?? false;
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            {t.title.replace("{userName}", userName)}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            {t.description}
            {hasCustomPermissions ? (
              <Badge variant="warning">{t.customPermissions}</Badge>
            ) : (
              <Badge variant="secondary">{t.usingRoleDefaults}</Badge>
            )}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="bg-destructive/15 text-destructive text-sm p-3 rounded-md">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-right p-3 font-medium">{t.moduleHeader}</th>
                  {PERMISSION_ACTIONS.map((action) => (
                    <th
                      key={action}
                      className="text-center p-3 font-medium min-w-[80px]"
                    >
                      {ACTION_LABELS[action]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SYSTEM_MODULES.map((module) => (
                  <tr key={module} className="border-b hover:bg-muted/30">
                    <td className="p-3 font-medium">{MODULE_LABELS[module]}</td>
                    {PERMISSION_ACTIONS.map((action) => (
                      <td key={action} className="p-3 text-center">
                        <Checkbox
                          checked={getModulePermission(module, action)}
                          onCheckedChange={(checked) =>
                            handlePermissionChange(
                              module,
                              action,
                              checked === true
                            )
                          }
                          disabled={isSaving || isResetting}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={handleReset}
            disabled={isLoading || isSaving || isResetting}
            className="w-full sm:w-auto"
          >
            {isResetting ? (
              <Loader2 className="h-4 w-4 animate-spin ms-2" />
            ) : (
              <RotateCcw className="h-4 w-4 ms-2" />
            )}
            {t.resetToDefaults}
          </Button>
          <div className="flex gap-2 w-full sm:w-auto">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={isSaving || isResetting}
              className="flex-1 sm:flex-none"
            >
              {t.cancel}
            </Button>
            <Button
              onClick={handleSave}
              disabled={isLoading || isSaving || isResetting || !hasChanges}
              className="flex-1 sm:flex-none"
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin ms-2" />
              ) : (
                <Save className="h-4 w-4 ms-2" />
              )}
              {t.savePermissions}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
