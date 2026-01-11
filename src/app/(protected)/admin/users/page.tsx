"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Users,
  UserCheck,
  UserX,
  Clock,
  Shield,
  Loader2,
  RefreshCw,
  Settings,
  Trash2,
  UserCog,
  Search,
  AlertTriangle,
  CheckCircle,
  XCircle,
} from "lucide-react";
import type { User, UserRole, UserStatus } from "@/db/schema";
import { PermissionsEditor } from "@/components/permissions-editor";
import { he } from "@/lib/translations/he";

interface UserWithExtras extends User {
  approverName?: string;
}

type FilterTab = "all" | "pending" | "active" | "suspended";

export default function AdminUsersPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [users, setUsers] = useState<UserWithExtras[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<UserWithExtras[]>([]);
  const [stats, setStats] = useState<{
    total: number;
    pending: number;
    active: number;
    suspended: number;
    byRole: Record<UserRole, number>;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [approvingUserId, setApprovingUserId] = useState<string | null>(null);
  const [rejectingUserId, setRejectingUserId] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<Record<string, UserRole>>({});
  const [permissionsEditorOpen, setPermissionsEditorOpen] = useState(false);
  const [selectedUserForPermissions, setSelectedUserForPermissions] = useState<UserWithExtras | null>(null);

  // Dialog states
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [userToReject, setUserToReject] = useState<UserWithExtras | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<UserWithExtras | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [roleChangeDialogOpen, setRoleChangeDialogOpen] = useState(false);
  const [userForRoleChange, setUserForRoleChange] = useState<UserWithExtras | null>(null);
  const [newRole, setNewRole] = useState<UserRole | "">("");
  const [isChangingRole, setIsChangingRole] = useState(false);

  const { data: session, isPending } = authClient.useSession();
  const userRole = session ? (session.user as { role?: string })?.role : undefined;

  useEffect(() => {
    // Auth checks are handled by the protected layout
    // Check if user has permission (admin-specific check)
    if (!isPending && session?.user && userRole !== "super_user" && userRole !== "admin") {
      router.push("/dashboard");
      return;
    }

    if (!isPending && session) {
      fetchUsers();
    }
  }, [session, isPending, router, userRole]);

  // Filter users when tab or search changes
  useEffect(() => {
    let filtered = users;

    // Filter by tab
    if (activeTab !== "all") {
      filtered = filtered.filter((user) => user.status === activeTab);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (user) =>
          user.name.toLowerCase().includes(query) ||
          user.email.toLowerCase().includes(query)
      );
    }

    setFilteredUsers(filtered);
  }, [users, activeTab, searchQuery]);

  const fetchUsers = async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/users?filter=all&stats=true`);
      if (!response.ok) {
        throw new Error("Failed to fetch users");
      }
      const data = await response.json();
      setUsers(data.users || []);
      setStats(data.stats || null);
    } catch (error) {
      console.error("Error fetching users:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprove = async (userId: string) => {
    const role = selectedRole[userId];
    if (!role) {
      alert("יש לבחור תפקיד לפני האישור");
      return;
    }

    try {
      setApprovingUserId(userId);
      const response = await fetch(`/api/users/${userId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to approve user");
      }

      // Refresh the list
      await fetchUsers();
    } catch (error) {
      console.error("Error approving user:", error);
      alert(error instanceof Error ? error.message : "שגיאה באישור המשתמש");
    } finally {
      setApprovingUserId(null);
    }
  };

  const handleOpenRejectDialog = (user: UserWithExtras) => {
    setUserToReject(user);
    setRejectReason("");
    setRejectDialogOpen(true);
  };

  const handleReject = async () => {
    if (!userToReject) return;

    try {
      setRejectingUserId(userToReject.id);
      const response = await fetch(`/api/users/${userToReject.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to reject user");
      }

      setRejectDialogOpen(false);
      setUserToReject(null);
      setRejectReason("");
      await fetchUsers();
    } catch (error) {
      console.error("Error rejecting user:", error);
      alert(error instanceof Error ? error.message : "שגיאה בדחיית המשתמש");
    } finally {
      setRejectingUserId(null);
    }
  };

  const handleSuspend = async (userId: string) => {
    if (!confirm(he.admin.users.confirmSuspend)) {
      return;
    }

    try {
      const response = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "suspended" }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "שגיאה בהשעיית המשתמש");
      }

      await fetchUsers();
    } catch (error) {
      console.error("Error suspending user:", error);
      alert(error instanceof Error ? error.message : "שגיאה בהשעיית המשתמש");
    }
  };

  const handleReactivate = async (userId: string) => {
    try {
      const response = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "שגיאה בהפעלת המשתמש מחדש");
      }

      await fetchUsers();
    } catch (error) {
      console.error("Error reactivating user:", error);
      alert(error instanceof Error ? error.message : "שגיאה בהפעלת המשתמש מחדש");
    }
  };

  const handleOpenDeleteDialog = (user: UserWithExtras) => {
    setUserToDelete(user);
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!userToDelete) return;

    try {
      setIsDeleting(true);
      const response = await fetch(`/api/users/${userToDelete.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "שגיאה במחיקת המשתמש");
      }

      setDeleteDialogOpen(false);
      setUserToDelete(null);
      await fetchUsers();
    } catch (error) {
      console.error("Error deleting user:", error);
      alert(error instanceof Error ? error.message : "שגיאה במחיקת המשתמש");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleOpenRoleChangeDialog = (user: UserWithExtras) => {
    setUserForRoleChange(user);
    setNewRole(user.role || "");
    setRoleChangeDialogOpen(true);
  };

  const handleRoleChange = async () => {
    if (!userForRoleChange || !newRole) return;

    try {
      setIsChangingRole(true);
      const response = await fetch(`/api/users/${userForRoleChange.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "שגיאה בשינוי התפקיד");
      }

      setRoleChangeDialogOpen(false);
      setUserForRoleChange(null);
      setNewRole("");
      await fetchUsers();
    } catch (error) {
      console.error("Error changing role:", error);
      alert(error instanceof Error ? error.message : "שגיאה בשינוי התפקיד");
    } finally {
      setIsChangingRole(false);
    }
  };

  const handleOpenPermissions = (user: UserWithExtras) => {
    setSelectedUserForPermissions(user);
    setPermissionsEditorOpen(true);
  };

  const handleClosePermissions = () => {
    setPermissionsEditorOpen(false);
    setSelectedUserForPermissions(null);
  };

  const getStatusBadge = (status: UserStatus) => {
    switch (status) {
      case "active":
        return <Badge variant="success">{he.status.user.active}</Badge>;
      case "pending":
        return <Badge variant="warning">{he.status.user.pending}</Badge>;
      case "suspended":
        return <Badge variant="destructive">{he.status.user.suspended}</Badge>;
      default:
        return <Badge variant="outline">{he.status.user.unknown}</Badge>;
    }
  };

  const getRoleBadge = (role: UserRole | null | undefined) => {
    if (!role) return <Badge variant="outline">{he.roles.noRole}</Badge>;

    switch (role) {
      case "super_user":
        return <Badge variant="default">{he.roles.super_user}</Badge>;
      case "admin":
        return <Badge variant="info">{he.roles.admin}</Badge>;
      case "franchisee_owner":
        return <Badge variant="secondary">{he.roles.franchisee_owner}</Badge>;
      default:
        return <Badge variant="outline">{role}</Badge>;
    }
  };

  const getTabCount = (tab: FilterTab) => {
    if (!stats) return 0;
    switch (tab) {
      case "all":
        return stats.total;
      case "pending":
        return stats.pending;
      case "active":
        return stats.active;
      case "suspended":
        return stats.suspended;
    }
  };

  if (isLoading || isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">{he.admin.users.title}</h1>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-4 mb-8">
          <Card
            className={`cursor-pointer transition-colors ${activeTab === "all" ? "ring-2 ring-primary" : "hover:bg-muted/50"}`}
            onClick={() => setActiveTab("all")}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{he.admin.users.stats.totalUsers}</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          <Card
            className={`cursor-pointer transition-colors ${activeTab === "pending" ? "ring-2 ring-primary" : "hover:bg-muted/50"}`}
            onClick={() => setActiveTab("pending")}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{he.admin.users.stats.pendingApproval}</CardTitle>
              <Clock className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.pending}</div>
            </CardContent>
          </Card>
          <Card
            className={`cursor-pointer transition-colors ${activeTab === "active" ? "ring-2 ring-primary" : "hover:bg-muted/50"}`}
            onClick={() => setActiveTab("active")}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{he.admin.users.stats.activeUsers}</CardTitle>
              <UserCheck className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.active}</div>
            </CardContent>
          </Card>
          <Card
            className={`cursor-pointer transition-colors ${activeTab === "suspended" ? "ring-2 ring-primary" : "hover:bg-muted/50"}`}
            onClick={() => setActiveTab("suspended")}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{he.admin.users.stats.suspended}</CardTitle>
              <UserX className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.suspended}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Search and Tabs */}
      <div className="mb-6">
        <div className="flex items-center gap-4 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={he.admin.users.search.placeholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pr-10"
            />
          </div>
          <Button variant="outline" onClick={fetchUsers}>
            <RefreshCw className="ml-2 h-4 w-4" />
            {he.common.refresh}
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as FilterTab)}>
          <TabsList className="grid w-full grid-cols-4 max-w-xl">
            <TabsTrigger value="all" className="gap-2">
              {he.admin.users.tabs.all}
              <Badge variant="secondary" className="mr-1">
                {getTabCount("all")}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="pending" className="gap-2">
              {he.admin.users.tabs.pending}
              {stats && stats.pending > 0 && (
                <Badge variant="warning" className="mr-1">
                  {stats.pending}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="active" className="gap-2">
              {he.admin.users.tabs.active}
              <Badge variant="secondary" className="mr-1">
                {getTabCount("active")}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="suspended" className="gap-2">
              {he.admin.users.tabs.suspended}
              <Badge variant="secondary" className="mr-1">
                {getTabCount("suspended")}
              </Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Users List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            {activeTab === "pending" ? he.admin.users.list.titlePending :
             activeTab === "active" ? he.admin.users.list.titleActive :
             activeTab === "suspended" ? he.admin.users.list.titleSuspended : he.admin.users.list.title}
          </CardTitle>
          <CardDescription>
            {activeTab === "pending"
              ? he.admin.users.list.descriptionPending
              : activeTab === "active"
              ? he.admin.users.list.descriptionActive
              : activeTab === "suspended"
              ? he.admin.users.list.descriptionSuspended
              : he.admin.users.list.description}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filteredUsers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {searchQuery
                ? he.admin.users.empty.noMatchingSearch
                : activeTab === "pending"
                ? he.admin.users.empty.noPendingUsers
                : activeTab === "suspended"
                ? he.admin.users.empty.noSuspendedUsers
                : he.admin.users.empty.noUsersFound}
            </div>
          ) : (
            <div className="space-y-4">
              {filteredUsers.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{user.name}</p>
                      {getStatusBadge(user.status)}
                      {getRoleBadge(user.role)}
                    </div>
                    <p className="text-sm text-muted-foreground">{user.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {he.admin.users.info.registered} {new Date(user.createdAt).toLocaleDateString("he-IL")}
                      {user.approvedAt && (
                        <>
                          {" | "}
                          {he.admin.users.info.approved} {new Date(user.approvedAt).toLocaleDateString("he-IL")}
                        </>
                      )}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Pending User Actions */}
                    {user.status === "pending" && userRole === "super_user" && (
                      <>
                        <Select
                          value={selectedRole[user.id] || ""}
                          onValueChange={(value) =>
                            setSelectedRole({
                              ...selectedRole,
                              [user.id]: value as UserRole,
                            })
                          }
                        >
                          <SelectTrigger className="w-[160px]">
                            <SelectValue placeholder={he.admin.users.actions.selectRole} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="super_user">{he.roles.super_user}</SelectItem>
                            <SelectItem value="admin">{he.roles.admin}</SelectItem>
                            <SelectItem value="franchisee_owner">{he.roles.franchisee_owner}</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          onClick={() => handleApprove(user.id)}
                          disabled={!selectedRole[user.id] || approvingUserId === user.id}
                        >
                          {approvingUserId === user.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <CheckCircle className="ml-1 h-4 w-4" />
                              {he.admin.users.actions.approve}
                            </>
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleOpenRejectDialog(user)}
                          disabled={rejectingUserId === user.id}
                        >
                          {rejectingUserId === user.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <XCircle className="ml-1 h-4 w-4" />
                              {he.admin.users.actions.reject}
                            </>
                          )}
                        </Button>
                      </>
                    )}

                    {/* Active User Actions */}
                    {user.status === "active" && userRole === "super_user" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleOpenRoleChangeDialog(user)}
                        >
                          <UserCog className="ml-1 h-4 w-4" />
                          {he.admin.users.actions.changeRole}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleOpenPermissions(user)}
                        >
                          <Settings className="ml-1 h-4 w-4" />
                          {he.admin.users.actions.permissions}
                        </Button>
                        {session?.user?.id !== user.id && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleSuspend(user.id)}
                            >
                              <UserX className="ml-1 h-4 w-4" />
                              {he.admin.users.actions.suspend}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              onClick={() => handleOpenDeleteDialog(user)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </>
                    )}

                    {/* Suspended User Actions */}
                    {user.status === "suspended" && userRole === "super_user" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleReactivate(user.id)}
                        >
                          <UserCheck className="ml-1 h-4 w-4" />
                          {he.admin.users.actions.reactivate}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleOpenDeleteDialog(user)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reject User Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {he.admin.users.dialogs.reject.title}
            </DialogTitle>
            <DialogDescription>
              {he.admin.users.dialogs.reject.description.replace("{name}", userToReject?.name || "")}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="rejectReason">{he.admin.users.dialogs.reject.reasonLabel}</Label>
            <Textarea
              id="rejectReason"
              placeholder={he.admin.users.dialogs.reject.reasonPlaceholder}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="mt-2"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRejectDialogOpen(false)}
              disabled={rejectingUserId !== null}
            >
              {he.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={rejectingUserId !== null}
            >
              {rejectingUserId ? (
                <Loader2 className="h-4 w-4 animate-spin ml-2" />
              ) : (
                <XCircle className="h-4 w-4 ml-2" />
              )}
              {he.admin.users.dialogs.reject.confirmButton}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete User Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {he.admin.users.dialogs.delete.title}
            </DialogTitle>
            <DialogDescription>
              {he.admin.users.dialogs.delete.description.replace("{name}", userToDelete?.name || "")}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-2">
            <p className="text-sm"><strong>{he.common.name}:</strong> {userToDelete?.name}</p>
            <p className="text-sm"><strong>{he.common.email}:</strong> {userToDelete?.email}</p>
            <p className="text-sm"><strong>{he.common.status}:</strong> {userToDelete?.status ? (
              userToDelete.status === "active" ? he.status.user.active :
              userToDelete.status === "pending" ? he.status.user.pending :
              userToDelete.status === "suspended" ? he.status.user.suspended : userToDelete.status
            ) : ""}</p>
            <p className="text-sm"><strong>{he.common.role}:</strong> {userToDelete?.role ? (
              userToDelete.role === "super_user" ? he.roles.super_user :
              userToDelete.role === "admin" ? he.roles.admin :
              userToDelete.role === "franchisee_owner" ? he.roles.franchisee_owner : userToDelete.role
            ) : he.roles.noRole}</p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={isDeleting}
            >
              {he.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <Loader2 className="h-4 w-4 animate-spin ml-2" />
              ) : (
                <Trash2 className="h-4 w-4 ml-2" />
              )}
              {he.admin.users.dialogs.delete.confirmButton}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Role Change Dialog */}
      <Dialog open={roleChangeDialogOpen} onOpenChange={setRoleChangeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCog className="h-5 w-5" />
              {he.admin.users.dialogs.changeRole.title}
            </DialogTitle>
            <DialogDescription>
              {he.admin.users.dialogs.changeRole.description.replace("{name}", userForRoleChange?.name || "")}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <p className="text-sm"><strong>{he.admin.users.dialogs.changeRole.currentRole}</strong> {userForRoleChange?.role ? (
                userForRoleChange.role === "super_user" ? he.roles.super_user :
                userForRoleChange.role === "admin" ? he.roles.admin :
                userForRoleChange.role === "franchisee_owner" ? he.roles.franchisee_owner : userForRoleChange.role
              ) : he.roles.noRole}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="newRole">{he.admin.users.dialogs.changeRole.newRoleLabel}</Label>
              <Select
                value={newRole}
                onValueChange={(value) => setNewRole(value as UserRole)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={he.admin.users.dialogs.changeRole.selectRole} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="super_user">{he.roles.super_user}</SelectItem>
                  <SelectItem value="admin">{he.roles.admin}</SelectItem>
                  <SelectItem value="franchisee_owner">{he.roles.franchisee_owner}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRoleChangeDialogOpen(false)}
              disabled={isChangingRole}
            >
              {he.common.cancel}
            </Button>
            <Button
              onClick={handleRoleChange}
              disabled={isChangingRole || !newRole || newRole === userForRoleChange?.role}
            >
              {isChangingRole ? (
                <Loader2 className="h-4 w-4 animate-spin ml-2" />
              ) : (
                <UserCog className="h-4 w-4 ml-2" />
              )}
              {he.admin.users.dialogs.changeRole.confirmButton}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Permissions Editor Dialog */}
      {selectedUserForPermissions && (
        <PermissionsEditor
          userId={selectedUserForPermissions.id}
          userName={selectedUserForPermissions.name}
          userRole={selectedUserForPermissions.role}
          isOpen={permissionsEditorOpen}
          onClose={handleClosePermissions}
          onSave={fetchUsers}
        />
      )}
    </div>
  );
}
