"use client";

import { useState, useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChevronRight,
  Globe,
  Mail,
  Phone,
  MapPin,
  Calendar,
  Pencil,
  Loader2,
  FileText,
  Tag,
  Info,
  ExternalLink,
} from "lucide-react";
import { DocumentManager } from "@/components/document-manager";
import type { Brand, Document } from "@/db/schema";
import { he } from "@/lib/translations/he";

const t = he.admin.brands;

interface DocumentWithUploader extends Document {
  uploaderName?: string | null;
  uploaderEmail?: string | null;
}

export default function BrandDetailPage() {
  const params = useParams();
  const router = useRouter();
  const brandId = params.brandId as string;

  const [activeTab, setActiveTab] = useState("overview");
  const [documents, setDocuments] = useState<DocumentWithUploader[]>([]);
  const [documentsLoaded, setDocumentsLoaded] = useState(false);
  const [documentsLoading, setDocumentsLoading] = useState(false);

  const {
    data: brandData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["brands", brandId],
    queryFn: async () => {
      const response = await fetchWithTimeout(`/api/brands/${brandId}`);
      if (!response.ok) throw new Error("Failed to fetch brand");
      return response.json();
    },
    enabled: !!brandId,
  });

  const brand: Brand | undefined = brandData?.brand;

  const fetchDocuments = useCallback(async () => {
    if (documentsLoaded || documentsLoading) return;
    setDocumentsLoading(true);
    try {
      const response = await fetchWithTimeout(
        `/api/documents/brand/${brandId}`
      );
      if (response.ok) {
        const data = await response.json();
        setDocuments(data.documents || []);
      }
    } catch (err) {
      console.error("Failed to fetch documents:", err);
    } finally {
      setDocumentsLoading(false);
      setDocumentsLoaded(true);
    }
  }, [brandId, documentsLoaded, documentsLoading]);

  useEffect(() => {
    if (activeTab === "documents") {
      fetchDocuments();
    }
  }, [activeTab, fetchDocuments]);

  const handleDocumentsChange = (updatedDocuments: DocumentWithUploader[]) => {
    setDocuments(updatedDocuments);
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !brand) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-16 text-muted-foreground">
          <p>לא נמצא מותג</p>
          <Link href="/admin/brands">
            <Button variant="link" className="mt-4">
              {t.detail.backToList}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const hasContactInfo = brand.contactEmail || brand.contactPhone || brand.address || brand.website;

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-5xl">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link
          href="/admin/brands"
          className="hover:text-foreground transition-colors"
        >
          {he.sidebar.subNavigation.brands}
        </Link>
        <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180 opacity-50" />
        <span className="text-foreground font-medium">{brand.nameHe}</span>
      </nav>

      {/* Brand Hero Header */}
      <Card className="overflow-hidden">
        <div className="relative">
          {/* Subtle gradient top accent */}
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-l from-primary/80 via-primary/40 to-transparent" />

          <CardContent className="p-8">
            <div className="flex items-center gap-8">
              {/* Logo */}
              <div className="flex-shrink-0">
                {brand.logoUrl ? (
                  <div className="relative w-28 h-20 rounded-xl bg-muted/30 border border-border/50 flex items-center justify-center p-3">
                    <Image
                      src={brand.logoUrl}
                      alt={brand.nameHe}
                      width={100}
                      height={64}
                      className="object-contain"
                    />
                  </div>
                ) : (
                  <div className="w-28 h-20 rounded-xl bg-muted/50 border border-border/50 flex items-center justify-center">
                    <Tag className="h-8 w-8 text-muted-foreground/50" />
                  </div>
                )}
              </div>

              {/* Brand Identity */}
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-baseline gap-3 flex-wrap">
                  <h1 className="text-2xl font-bold tracking-tight">
                    {brand.nameHe}
                  </h1>
                  {brand.nameEn && (
                    <span
                      className="text-base text-muted-foreground font-medium"
                      dir="ltr"
                    >
                      {brand.nameEn}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2.5">
                  <Badge
                    variant="outline"
                    className="font-mono text-xs tracking-wider"
                  >
                    {brand.code}
                  </Badge>
                  <Badge
                    variant={brand.isActive ? "default" : "secondary"}
                    className="text-xs"
                  >
                    {brand.isActive ? he.common.active : he.common.inactive}
                  </Badge>
                  {brand.createdAt && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {new Date(brand.createdAt).toLocaleDateString("he-IL")}
                    </span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/admin/brands?edit=${brand.id}`)}
                className="flex-shrink-0"
              >
                <Pencil className="h-3.5 w-3.5 me-1.5" />
                {he.common.edit}
              </Button>
            </div>
          </CardContent>
        </div>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full justify-start bg-muted/50 p-1">
          <TabsTrigger
            value="overview"
            className="gap-2 data-[state=active]:bg-background"
          >
            <Info className="h-4 w-4" />
            {t.detail.tabs.overview}
          </TabsTrigger>
          <TabsTrigger
            value="documents"
            className="gap-2 data-[state=active]:bg-background"
          >
            <FileText className="h-4 w-4" />
            {t.detail.tabs.documents}
            {documents.length > 0 && (
              <Badge
                variant="secondary"
                className="h-5 min-w-5 px-1.5 text-xs font-semibold"
              >
                {documents.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="mt-6">
          <div className="grid gap-6 md:grid-cols-5">
            {/* Main info — wider column */}
            <Card className="md:col-span-3">
              <CardContent className="p-6 space-y-6">
                {/* Description Section */}
                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground mb-2">
                    {t.detail.overview.description}
                  </h3>
                  <p
                    className={
                      brand.description
                        ? "text-sm leading-relaxed"
                        : "text-sm text-muted-foreground italic"
                    }
                  >
                    {brand.description || t.detail.overview.noDescription}
                  </p>
                </div>

                <Separator />

                {/* Contact Info Section */}
                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground mb-4">
                    {t.detail.overview.contactInfo}
                  </h3>

                  {hasContactInfo ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      {brand.website && (
                        <div className="flex items-start gap-3 group">
                          <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950/30">
                            <Globe className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs text-muted-foreground mb-0.5">
                              {t.detail.overview.website}
                            </p>
                            <a
                              href={brand.website}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                              dir="ltr"
                            >
                              {brand.website.replace(/^https?:\/\//, "")}
                              <ExternalLink className="h-3 w-3 opacity-50" />
                            </a>
                          </div>
                        </div>
                      )}

                      {brand.contactEmail && (
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/30">
                            <Mail className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs text-muted-foreground mb-0.5">
                              {t.detail.overview.contactEmail}
                            </p>
                            <a
                              href={`mailto:${brand.contactEmail}`}
                              className="text-sm text-primary hover:underline"
                              dir="ltr"
                            >
                              {brand.contactEmail}
                            </a>
                          </div>
                        </div>
                      )}

                      {brand.contactPhone && (
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-violet-50 dark:bg-violet-950/30">
                            <Phone className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs text-muted-foreground mb-0.5">
                              {t.detail.overview.contactPhone}
                            </p>
                            <span className="text-sm" dir="ltr">
                              {brand.contactPhone}
                            </span>
                          </div>
                        </div>
                      )}

                      {brand.address && (
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-950/30">
                            <MapPin className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs text-muted-foreground mb-0.5">
                              {t.detail.overview.address}
                            </p>
                            <span className="text-sm">{brand.address}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">
                      {t.detail.overview.noContactInfo}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Side panel — narrow column */}
            <Card className="md:col-span-2">
              <CardContent className="p-6">
                <h3 className="text-sm font-semibold text-muted-foreground mb-4">
                  {t.detail.overview.brandInfo}
                </h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      {t.detail.overview.code}
                    </span>
                    <Badge
                      variant="outline"
                      className="font-mono text-xs tracking-wider"
                    >
                      {brand.code}
                    </Badge>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      {t.detail.overview.status}
                    </span>
                    <Badge
                      variant={brand.isActive ? "default" : "secondary"}
                      className="text-xs"
                    >
                      {brand.isActive ? he.common.active : he.common.inactive}
                    </Badge>
                  </div>
                  <Separator />
                  {brand.createdAt && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        {t.detail.overview.created}
                      </span>
                      <span className="text-sm flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                        {new Date(brand.createdAt).toLocaleDateString("he-IL")}
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Documents Tab */}
        <TabsContent value="documents" className="mt-6">
          {documentsLoading && !documentsLoaded ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <DocumentManager
              entityType="brand"
              entityId={brandId}
              entityName={brand.nameHe}
              documents={documents}
              onDocumentsChange={handleDocumentsChange}
              canUpload={true}
              canDelete={true}
              canEdit={true}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
