import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { EmailTemplate } from "@/db/schema";
import type { EmailTemplateType } from "@/lib/email/constants";

export const emailTemplateKeys = {
  all: ["email-templates"] as const,
  lists: () => [...emailTemplateKeys.all, "list"] as const,
  list: (filters: Record<string, unknown>) =>
    [...emailTemplateKeys.lists(), filters] as const,
  details: () => [...emailTemplateKeys.all, "detail"] as const,
  detail: (id: string) => [...emailTemplateKeys.details(), id] as const,
  stats: () => [...emailTemplateKeys.all, "stats"] as const,
};

interface EmailTemplateStats {
  total: number;
  active: number;
  inactive: number;
  byCategory: Record<string, number>;
}

interface EmailTemplatesResponse {
  templates: EmailTemplate[];
  stats: EmailTemplateStats;
}

interface EmailTemplateFilters {
  filter?: "all" | "active";
  category?: string;
  [key: string]: unknown;
}

async function fetchEmailTemplates(
  filters: EmailTemplateFilters
): Promise<EmailTemplatesResponse> {
  const params = new URLSearchParams({ stats: "true" });
  if (filters.filter === "active") params.set("filter", "active");
  if (filters.category && filters.category !== "all")
    params.set("category", filters.category);

  const res = await fetchWithTimeout(`/api/email-templates?${params}`);
  if (!res.ok) throw new Error("Failed to fetch email templates");
  return res.json();
}

export function useEmailTemplates(filters: EmailTemplateFilters = {}) {
  return useQuery({
    queryKey: emailTemplateKeys.list(filters),
    queryFn: () => fetchEmailTemplates(filters),
  });
}

export function useActiveEmailTemplates() {
  return useQuery({
    queryKey: emailTemplateKeys.list({ filter: "active" }),
    queryFn: () => fetchEmailTemplates({ filter: "active" }),
    select: (data) => data.templates,
  });
}

interface CreateEmailTemplateData {
  name: string;
  code: string;
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  description?: string;
  category: EmailTemplateType;
  isActive: boolean;
}

export function useCreateEmailTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateEmailTemplateData) => {
      const res = await fetchWithTimeout("/api/email-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to create template");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: emailTemplateKeys.all });
    },
  });
}

export function useUpdateEmailTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<CreateEmailTemplateData>;
    }) => {
      const res = await fetchWithTimeout(`/api/email-templates/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to update template");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: emailTemplateKeys.all });
    },
  });
}

export function useDeleteEmailTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetchWithTimeout(`/api/email-templates/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to delete template");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: emailTemplateKeys.all });
    },
  });
}

export function useToggleEmailTemplateStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetchWithTimeout(`/api/email-templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle_status" }),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to toggle template status");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: emailTemplateKeys.all });
    },
  });
}

export function usePreviewEmailTemplate() {
  return useMutation({
    mutationFn: async ({
      templateId,
      variables = {},
    }: {
      templateId: string;
      variables?: Record<string, string>;
    }) => {
      const res = await fetchWithTimeout(
        `/api/email-templates/${templateId}/preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ variables }),
        }
      );
      if (!res.ok) throw new Error("Failed to preview template");
      const data = await res.json();
      return data.preview as { subject: string; html: string; text: string };
    },
  });
}

export function useSendEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      templateId,
      to,
      toName,
      variables = {},
      entityType,
      entityId,
      replyTo,
    }: {
      templateId: string;
      to: string;
      toName?: string;
      variables?: Record<string, string>;
      entityType?: string;
      entityId?: string;
      replyTo?: string;
    }) => {
      const res = await fetchWithTimeout(
        `/api/email-templates/${templateId}/send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to,
            toName,
            variables,
            entityType,
            entityId,
            replyTo,
          }),
        }
      );
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to send email");
      }
      return res.json();
    },
    onSuccess: () => {
      // Invalidate email logs to show the new sent email
      queryClient.invalidateQueries({ queryKey: ["email-logs"] });
    },
  });
}
