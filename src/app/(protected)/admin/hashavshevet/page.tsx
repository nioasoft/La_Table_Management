"use client";

import type { ReactNode } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CompaniesSection } from "@/components/hashavshevet/companies-section";
import { MappingsSection } from "@/components/hashavshevet/mappings-section";
import { EmptyBlock, LoadingBlock, QueryBoundary } from "@/components/hashavshevet/query-boundary";
import { useAdminAuth } from "@/hooks/use-admin-auth";
import { settingsCopy } from "@/lib/hashavshevet/copy";
import { useCompanies, useMappings } from "@/queries/hashavshevet";

interface BoundaryState {
  isPending: boolean;
  isError: boolean;
  isEmpty: boolean;
  onRetry: () => void;
}

function SettingsCard({ title, description, state, empty, children }: { title: string; description?: string; state: BoundaryState; empty: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <QueryBoundary
          {...state}
          loadingLabel={settingsCopy.loading}
          errorMessage={settingsCopy.loadFailed}
          retryLabel={settingsCopy.retry}
          empty={empty}
        >
          {children}
        </QueryBoundary>
      </CardContent>
    </Card>
  );
}

/** Spec §9: Hashavshevet companies (activation, approval) and brand / franchisee mappings. Admins read, super users edit. */
export default function HashavshevetSettingsPage() {
  const { isAuthorized, isPending, isSuperUser } = useAdminAuth();
  const companies = useCompanies();
  const mappings = useMappings();

  if (isPending) return <LoadingBlock label={settingsCopy.loading} />;
  if (!isAuthorized) return null; // useAdminAuth is redirecting

  const bothLoaded = mappings.data && companies.data;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{settingsCopy.title}</h1>
        <p className="mt-1 text-muted-foreground">{settingsCopy.subtitle}</p>
        {!isSuperUser && <p className="mt-2 text-sm text-muted-foreground">{settingsCopy.readOnlyNote}</p>}
      </div>
      <SettingsCard
        title={settingsCopy.companiesTitle}
        state={{ isPending: companies.isPending, isError: companies.isError, isEmpty: companies.data?.length === 0, onRetry: () => companies.refetch() }}
        empty={<EmptyBlock title={settingsCopy.companiesEmpty} />}
      >
        <CompaniesSection companies={companies.data ?? []} isSuperUser={isSuperUser} />
      </SettingsCard>
      <SettingsCard
        title={settingsCopy.mappingsTitle}
        description={settingsCopy.mappingsHint}
        state={{
          isPending: mappings.isPending || companies.isPending,
          isError: mappings.isError || companies.isError,
          isEmpty: false,
          onRetry: () => void Promise.all([mappings.refetch(), companies.refetch()]),
        }}
        empty={null}
      >
        {bothLoaded && <MappingsSection mappings={mappings.data} companies={companies.data} isSuperUser={isSuperUser} />}
      </SettingsCard>
    </div>
  );
}
