"use client";

import { useMemo, useState } from "react";

import { EmptyBlock, LoadingBlock, QueryBoundary } from "@/components/hashavshevet/query-boundary";
import { SendDetailDialog } from "@/components/hashavshevet/send-detail-dialog";
import { SendsHistory } from "@/components/hashavshevet/sends-history";
import { SendsQueue } from "@/components/hashavshevet/sends-queue";
import { useAdminAuth } from "@/hooks/use-admin-auth";
import { sendsCopy } from "@/lib/hashavshevet/copy";
import { useSends } from "@/queries/hashavshevet";
import { partitionSends } from "../page-state";

/** Spec §9: the approval queue on top (Reut compares each send to the temporary batch), history below. */
export default function HashavshevetSendsPage() {
  const { isAuthorized, isPending, isSuperUser } = useAdminAuth();
  const sends = useSends();
  const [openId, setOpenId] = useState<string | null>(null);
  const { queue, history } = useMemo(() => partitionSends(sends.data ?? []), [sends.data]);

  if (isPending) return <LoadingBlock label={sendsCopy.loading} />;
  if (!isAuthorized) return null; // useAdminAuth is redirecting

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{sendsCopy.title}</h1>
        <p className="mt-1 text-muted-foreground">{sendsCopy.subtitle}</p>
      </div>
      <QueryBoundary
        isPending={sends.isPending}
        isError={sends.isError}
        isEmpty={sends.data?.length === 0}
        onRetry={() => sends.refetch()}
        loadingLabel={sendsCopy.loading}
        errorMessage={sendsCopy.loadFailed}
        retryLabel={sendsCopy.retry}
        empty={<EmptyBlock title={sendsCopy.emptyTitle} hint={sendsCopy.emptyHint} />}
      >
        <SendsQueue sends={queue} onOpen={setOpenId} />
        <SendsHistory sends={history} onOpen={setOpenId} />
      </QueryBoundary>
      {openId && <SendDetailDialog sendId={openId} isSuperUser={isSuperUser} onClose={() => setOpenId(null)} />}
    </div>
  );
}
