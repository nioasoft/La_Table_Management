"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  Bell,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  Check,
  Loader2,
  Calendar,
  Mail,
  Clock,
  Send,
  BellOff,
} from "lucide-react";
import type { FranchiseeReminder, FranchiseeReminderType, ReminderStatus } from "@/db/schema";
import { he } from "@/lib/translations/he";
import { authClient } from "@/lib/auth-client";

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

export default function FranchiseeRemindersTab() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"all" | ReminderStatus>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | FranchiseeReminderType>("all");
  const [showForm, setShowForm] = useState(false);
  const [editingReminder, setEditingReminder] = useState<FranchiseeReminderWithFranchisee | null>(null);
  const [formData, setFormData] = useState<ReminderFormData>(initialFormData);
  const [formError, setFormError] = useState<string | null>(null);

  const { data: session } = authClient.useSession();
  const userRole = session ? (session.user as { role?: string })?.role : undefined;

  // Fetch reminders with TanStack Query
  const { data: remindersData, isLoading, refetch: fetchReminders } = useQuery({
    queryKey: ["franchisee-reminders", "list", { filter, typeFilter, stats: true }],
    queryFn: async () => {
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
      return response.json();
    },
  });

  const reminders: FranchiseeReminderWithFranchisee[] = remindersData?.reminders || [];
  const stats = remindersData?.stats || null;

  // Fetch franchisees with TanStack Query
  const { data: franchiseesData } = useQuery({
    queryKey: ["franchisees", "list", { filter: "active" }],
    queryFn: async () => {
      const response = await fetch("/api/franchisees?filter=active");
      if (!response.ok) {
        throw new Error("Failed to fetch franchisees");
      }
      return response.json();
    },
  });

  const franchisees: Franchisee[] = franchiseesData?.franchisees || [];

  // Create reminder mutation
  const createReminder = useMutation({
    mutationFn: async (data: { formData: typeof formData; recipients: string[] }) => {
      const response = await fetch("/api/franchisee-reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data.formData,
          recipients: data.recipients,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || t.errors.failedToCreate);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["franchisee-reminders"] });
      setShowForm(false);
      setEditingReminder(null);
      setFormData(initialFormData);
    },
    onError: (error: Error) => {
      setFormError(error.message);
    },
  });

  // Update reminder mutation
  const updateReminder = useMutation({
    mutationFn: async (data: { id: string; formData: typeof formData; recipients: string[] }) => {
      const response = await fetch(`/api/franchisee-reminders/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data.formData,
          recipients: data.recipients,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || t.errors.failedToUpdate);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["franchisee-reminders"] });
      setShowForm(false);
      setEditingReminder(null);
      setFormData(initialFormData);
    },
    onError: (error: Error) => {
      setFormError(error.message);
    },
  });

  // Delete reminder mutation
  const deleteReminder = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/franchisee-reminders/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || t.errors.failedToDelete);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["franchisee-reminders"] });
    },
    onError: (error: Error) => {
      alert(error.message);
    },
  });

  // Mark as sent mutation
  const markAsSentMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/franchisee-reminders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send" }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || t.errors.failedToMarkAsSent);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["franchisee-reminders"] });
    },
    onError: (error: Error) => {
      alert(error.message);
    },
  });

  // Dismiss mutation
  const dismissMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/franchisee-reminders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss" }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || t.errors.failedToDismiss);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["franchisee-reminders"] });
    },
    onError: (error: Error) => {
      alert(error.message);
    },
  });

  const isSubmitting = createReminder.isPending || updateReminder.isPending;

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

    if (editingReminder) {
      updateReminder.mutate({ id: editingReminder.id, formData, recipients: recipientList });
    } else {
      createReminder.mutate({ formData, recipients: recipientList });
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
    deleteReminder.mutate(reminderId);
  };

  const handleMarkAsSent = async (reminderId: string) => {
    markAsSentMutation.mutate(reminderId);
  };

  const handleDismiss = async (reminderId: string) => {
    dismissMutation.mutate(reminderId);
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-4">
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
      <div className="flex items-center justify-between gap-4 flex-wrap">
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
          <Button variant="outline" onClick={() => fetchReminders()}>
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
        <Card>
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
