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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LogOut,
  Bell,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  ChevronRight,
  X,
  Check,
  Loader2,
  Calendar,
  Mail,
  Clock,
  Send,
  BellOff,
} from "lucide-react";
import type { FranchiseeReminder, FranchiseeReminderType, ReminderStatus } from "@/db/schema";
import Link from "next/link";
import { he } from "@/lib/translations/he";

const t = he.admin.franchiseeReminders;
const tCommon = he.common;

interface FranchiseeReminderWithFranchisee extends FranchiseeReminder {
  franchisee: {
    id: string;
    name: string;
    code: string;
  } | null;
}

interface Franchisee {
  id: string;
  name: string;
  code: string;
}

interface ReminderFormData {
  franchiseeId: string;
  title: string;
  description: string;
  reminderType: FranchiseeReminderType;
  reminderDate: string;
  daysBeforeNotification: number;
  recipients: string;
}

const initialFormData: ReminderFormData = {
  franchiseeId: "",
  title: "",
  description: "",
  reminderType: "custom",
  reminderDate: "",
  daysBeforeNotification: 30,
  recipients: "",
};

const reminderTypeLabels: Record<FranchiseeReminderType, string> = {
  lease_option: t.types.leaseOption,
  franchise_agreement: t.types.franchiseAgreement,
  custom: t.types.custom,
};

const statusLabels: Record<ReminderStatus, string> = {
  pending: t.status.pending,
  sent: t.status.sent,
  acknowledged: t.status.acknowledged,
  dismissed: t.status.dismissed,
};

const statusColors: Record<ReminderStatus, "default" | "success" | "secondary" | "destructive"> = {
  pending: "default",
  sent: "success",
  acknowledged: "success",
  dismissed: "secondary",
};

export default function AdminFranchiseeRemindersPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [reminders, setReminders] = useState<FranchiseeReminderWithFranchisee[]>([]);
  const [franchisees, setFranchisees] = useState<Franchisee[]>([]);
  const [stats, setStats] = useState<{
    total: number;
    pending: number;
    sent: number;
    dismissed: number;
    upcomingThisWeek: number;
    upcomingThisMonth: number;
  } | null>(null);
  const [filter, setFilter] = useState<"all" | ReminderStatus>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | FranchiseeReminderType>("all");
  const [showForm, setShowForm] = useState(false);
  const [editingReminder, setEditingReminder] = useState<FranchiseeReminderWithFranchisee | null>(null);
  const [formData, setFormData] = useState<ReminderFormData>(initialFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { data: session, isPending } = authClient.useSession();

  const userRole = session ? (session.user as { role?: string })?.role : undefined;

  useEffect(() => {
    if (!isPending && !session) {
      router.push("/sign-in?redirect=/admin/franchisee-reminders");
      return;
    }

    if (!isPending && session?.user && userRole !== "super_user" && userRole !== "admin") {
      router.push("/dashboard");
      return;
    }

    if (!isPending && session) {
      fetchReminders();
      fetchFranchisees();
    }
  }, [session, isPending, router, userRole, filter, typeFilter]);

  const fetchReminders = async () => {
    try {
      setIsLoading(true);
      let url = `/api/franchisee-reminders?stats=true`;
      if (filter !== "all") {
        url += `&status=${filter}`;
      }
      if (typeFilter !== "all") {
        url += `&type=${typeFilter}`;
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("Failed to fetch reminders");
      }
      const data = await response.json();
      setReminders(data.reminders || []);
      setStats(data.stats || null);
    } catch (error) {
      console.error("Error fetching reminders:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchFranchisees = async () => {
    try {
      const response = await fetch("/api/franchisees?filter=active");
      if (!response.ok) {
        throw new Error("Failed to fetch franchisees");
      }
      const data = await response.json();
      setFranchisees(data.franchisees || []);
    } catch (error) {
      console.error("Error fetching franchisees:", error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formData.franchiseeId || !formData.title || !formData.reminderDate || !formData.recipients) {
      setFormError(t.form.validation.requiredFields);
      return;
    }

    // Validate email format for recipients
    const recipientList = formData.recipients.split(",").map((email) => email.trim()).filter(Boolean);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const email of recipientList) {
      if (!emailRegex.test(email)) {
        setFormError(t.form.validation.invalidEmail.replace("{email}", email));
        return;
      }
    }

    try {
      setIsSubmitting(true);

      const url = editingReminder
        ? `/api/franchisee-reminders/${editingReminder.id}`
        : "/api/franchisee-reminders";

      const method = editingReminder ? "PATCH" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          recipients: recipientList,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || (editingReminder ? t.errors.failedToUpdate : t.errors.failedToCreate));
      }

      setShowForm(false);
      setEditingReminder(null);
      setFormData(initialFormData);
      await fetchReminders();
    } catch (error) {
      console.error("Error saving reminder:", error);
      setFormError(error instanceof Error ? error.message : t.errors.failedToSave);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (reminder: FranchiseeReminderWithFranchisee) => {
    setEditingReminder(reminder);
    setFormData({
      franchiseeId: reminder.franchiseeId,
      title: reminder.title,
      description: reminder.description || "",
      reminderType: reminder.reminderType,
      reminderDate: reminder.reminderDate,
      daysBeforeNotification: reminder.daysBeforeNotification,
      recipients: Array.isArray(reminder.recipients) ? reminder.recipients.join(", ") : "",
    });
    setShowForm(true);
    setFormError(null);
  };

  const handleDelete = async (reminderId: string) => {
    if (!confirm(t.confirmDelete)) {
      return;
    }

    try {
      const response = await fetch(`/api/franchisee-reminders/${reminderId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || t.errors.failedToDelete);
      }

      await fetchReminders();
    } catch (error) {
      console.error("Error deleting reminder:", error);
      alert(error instanceof Error ? error.message : t.errors.failedToDelete);
    }
  };

  const handleMarkAsSent = async (reminderId: string) => {
    try {
      const response = await fetch(`/api/franchisee-reminders/${reminderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send" }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || t.errors.failedToMarkAsSent);
      }

      await fetchReminders();
    } catch (error) {
      console.error("Error marking reminder as sent:", error);
      alert(error instanceof Error ? error.message : t.errors.failedToMarkAsSent);
    }
  };

  const handleDismiss = async (reminderId: string) => {
    try {
      const response = await fetch(`/api/franchisee-reminders/${reminderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss" }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || t.errors.failedToDismiss);
      }

      await fetchReminders();
    } catch (error) {
      console.error("Error dismissing reminder:", error);
      alert(error instanceof Error ? error.message : t.errors.failedToDismiss);
    }
  };

  const handleSignOut = async () => {
    await authClient.signOut();
    router.push("/sign-in");
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingReminder(null);
    setFormData(initialFormData);
    setFormError(null);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("he-IL", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
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
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm">
              <ChevronRight className="h-4 w-4 ml-1" />
              {tCommon.dashboard}
            </Button>
          </Link>
          <h1 className="text-3xl font-bold">{t.title}</h1>
        </div>
        <Button variant="outline" onClick={handleSignOut}>
          <LogOut className="ml-2 h-4 w-4" />
          {tCommon.signOut}
        </Button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-4 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t.stats.totalReminders}</CardTitle>
              <Bell className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t.stats.pending}</CardTitle>
              <Clock className="h-4 w-4 text-yellow-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.pending}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t.stats.sent}</CardTitle>
              <Send className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.sent}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t.stats.upcomingThisWeek}</CardTitle>
              <Calendar className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.upcomingThisWeek}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters and Actions */}
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div className="flex items-center gap-4 flex-wrap">
          <Select
            value={filter}
            onValueChange={(value) => setFilter(value as "all" | ReminderStatus)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={t.filters.filterByStatus} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.filters.allStatus}</SelectItem>
              <SelectItem value="pending">{t.filters.pending}</SelectItem>
              <SelectItem value="sent">{t.filters.sent}</SelectItem>
              <SelectItem value="dismissed">{t.filters.dismissed}</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={typeFilter}
            onValueChange={(value) => setTypeFilter(value as "all" | FranchiseeReminderType)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={t.filters.filterByType} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.filters.allTypes}</SelectItem>
              <SelectItem value="lease_option">{t.filters.leaseOption}</SelectItem>
              <SelectItem value="franchise_agreement">{t.filters.franchiseAgreement}</SelectItem>
              <SelectItem value="custom">{t.filters.custom}</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={fetchReminders}>
            <RefreshCw className="ml-2 h-4 w-4" />
            {t.actions.refresh}
          </Button>
        </div>
        <Button onClick={() => { setShowForm(true); setEditingReminder(null); setFormData(initialFormData); }}>
          <Plus className="ml-2 h-4 w-4" />
          {t.actions.addReminder}
        </Button>
      </div>

      {/* Reminder Form Modal */}
      {showForm && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{editingReminder ? t.form.editTitle : t.form.createTitle}</CardTitle>
            <CardDescription>
              {editingReminder
                ? t.form.editDescription
                : t.form.createDescription}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {formError && (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
                  <p className="text-sm text-destructive">{formError}</p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="franchiseeId">{t.form.fields.franchisee} *</Label>
                  <Select
                    value={formData.franchiseeId}
                    onValueChange={(value) => setFormData({ ...formData, franchiseeId: value })}
                    disabled={isSubmitting}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t.form.fields.franchiseePlaceholder} />
                    </SelectTrigger>
                    <SelectContent>
                      {franchisees.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.name} ({f.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reminderType">{t.form.fields.reminderType} *</Label>
                  <Select
                    value={formData.reminderType}
                    onValueChange={(value) => setFormData({ ...formData, reminderType: value as FranchiseeReminderType })}
                    disabled={isSubmitting}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t.form.fields.typePlaceholder} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="lease_option">{t.types.leaseOption}</SelectItem>
                      <SelectItem value="franchise_agreement">{t.types.franchiseAgreement}</SelectItem>
                      <SelectItem value="custom">{t.types.custom}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="title">{t.form.fields.title} *</Label>
                  <Input
                    id="title"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    placeholder={t.form.fields.titlePlaceholder}
                    disabled={isSubmitting}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reminderDate">{t.form.fields.reminderDate} *</Label>
                  <Input
                    id="reminderDate"
                    type="date"
                    value={formData.reminderDate}
                    onChange={(e) => setFormData({ ...formData, reminderDate: e.target.value })}
                    disabled={isSubmitting}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="daysBeforeNotification">{t.form.fields.daysBeforeNotification}</Label>
                  <Input
                    id="daysBeforeNotification"
                    type="number"
                    min="1"
                    max="365"
                    value={formData.daysBeforeNotification}
                    onChange={(e) => setFormData({ ...formData, daysBeforeNotification: parseInt(e.target.value) || 30 })}
                    disabled={isSubmitting}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="recipients">{t.form.fields.recipients} *</Label>
                  <Input
                    id="recipients"
                    value={formData.recipients}
                    onChange={(e) => setFormData({ ...formData, recipients: e.target.value })}
                    placeholder={t.form.fields.recipientsPlaceholder}
                    disabled={isSubmitting}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">{t.form.fields.description}</Label>
                <Input
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder={t.form.fields.descriptionPlaceholder}
                  disabled={isSubmitting}
                />
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={cancelForm} disabled={isSubmitting}>
                  {tCommon.cancel}
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                      {tCommon.saving}
                    </>
                  ) : (
                    <>
                      <Check className="ml-2 h-4 w-4" />
                      {editingReminder ? tCommon.update : tCommon.create}
                    </>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Reminders List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            {t.list.title}
          </CardTitle>
          <CardDescription>
            {t.list.description}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {reminders.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {t.list.emptyState}
            </div>
          ) : (
            <div className="space-y-4">
              {reminders.map((reminder) => (
                <div
                  key={reminder.id}
                  className="flex items-center justify-between p-4 rounded-lg border bg-card"
                >
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium">{reminder.title}</p>
                      <Badge variant={statusColors[reminder.status]}>
                        {statusLabels[reminder.status]}
                      </Badge>
                      <Badge variant="outline">
                        {reminderTypeLabels[reminder.reminderType]}
                      </Badge>
                    </div>
                    {reminder.franchisee && (
                      <p className="text-sm text-muted-foreground">
                        {t.list.franchisee} <span className="font-medium">{reminder.franchisee.name}</span> ({reminder.franchisee.code})
                      </p>
                    )}
                    {reminder.description && (
                      <p className="text-sm text-muted-foreground">{reminder.description}</p>
                    )}
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {t.list.reminderDate} {formatDate(reminder.reminderDate)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {t.list.notify} {t.list.daysBeforeTemplate.replace("{days}", String(reminder.daysBeforeNotification))}
                      </span>
                      <span className="flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {(() => {
                          const count = Array.isArray(reminder.recipients) ? reminder.recipients.length : 0;
                          return count === 1
                            ? t.list.oneRecipient
                            : t.list.recipientCount.replace("{count}", String(count));
                        })()}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {reminder.status === "pending" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleMarkAsSent(reminder.id)}
                          title={t.actions.markAsSent}
                        >
                          <Send className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDismiss(reminder.id)}
                          title={t.actions.dismiss}
                        >
                          <BellOff className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleEdit(reminder)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {userRole === "super_user" && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleDelete(reminder.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
