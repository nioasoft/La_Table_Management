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
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

  // Fetch brand data
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

  // Fetch documents when documents tab is opened
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

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/admin/brands">
          <Button variant="ghost" size="sm">
            <ChevronRight className="h-4 w-4 me-1" />
            {t.detail.backToList}
          </Button>
        </Link>
      </div>

      {/* Brand Header Card */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start gap-6">
            {/* Logo */}
            <div className="flex-shrink-0">
              {brand.logoUrl ? (
                <Image
                  src={brand.logoUrl}
                  alt={brand.nameHe}
                  width={120}
                  height={80}
                  className="object-contain rounded-lg"
                />
              ) : (
                <div className="flex h-20 w-[120px] items-center justify-center rounded-lg bg-muted">
                  <Tag className="h-8 w-8 text-muted-foreground" />
                </div>
              )}
            </div>

            {/* Brand Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold">{brand.nameHe}</h1>
                {brand.nameEn && (
                  <span className="text-lg text-muted-foreground" dir="ltr">
                    {brand.nameEn}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-2">
                <Badge variant="outline">{brand.code}</Badge>
                <Badge variant={brand.isActive ? "default" : "secondary"}>
                  {brand.isActive ? he.common.active : he.common.inactive}
                </Badge>
              </div>
            </div>

            {/* Edit Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/admin/brands?edit=${brand.id}`)}
            >
              <Pencil className="h-4 w-4 me-2" />
              {he.common.edit}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">{t.detail.tabs.overview}</TabsTrigger>
          <TabsTrigger value="documents">
            <FileText className="h-4 w-4 me-2" />
            {t.detail.tabs.documents}
            {documents.length > 0 && (
              <Badge variant="secondary" className="ms-2 h-5 min-w-5 px-1.5 text-xs">
                {documents.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="mt-6">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Details Card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t.detail.overview.description}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  {brand.description || t.detail.overview.noDescription}
                </p>
              </CardContent>
            </Card>

            {/* Contact Card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t.detail.overview.contactEmail.replace(" ליצירת קשר", "")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {brand.contactEmail || brand.contactPhone || brand.address || brand.website ? (
                  <>
                    {brand.website && (
                      <div className="flex items-center gap-3">
                        <Globe className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <a
                          href={brand.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-primary hover:underline"
                          dir="ltr"
                        >
                          {brand.website}
                        </a>
                      </div>
                    )}
                    {brand.contactEmail && (
                      <div className="flex items-center gap-3">
                        <Mail className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <a
                          href={`mailto:${brand.contactEmail}`}
                          className="text-sm text-primary hover:underline"
                          dir="ltr"
                        >
                          {brand.contactEmail}
                        </a>
                      </div>
                    )}
                    {brand.contactPhone && (
                      <div className="flex items-center gap-3">
                        <Phone className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <span className="text-sm" dir="ltr">
                          {brand.contactPhone}
                        </span>
                      </div>
                    )}
                    {brand.address && (
                      <div className="flex items-center gap-3">
                        <MapPin className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <span className="text-sm">{brand.address}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t.detail.overview.noContactInfo}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Metadata Card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t.detail.overview.status}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{t.detail.overview.code}</span>
                  <Badge variant="outline">{brand.code}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{t.detail.overview.status}</span>
                  <Badge variant={brand.isActive ? "default" : "secondary"}>
                    {brand.isActive ? he.common.active : he.common.inactive}
                  </Badge>
                </div>
                {brand.createdAt && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">{t.detail.overview.created}</span>
                    <div className="flex items-center gap-1.5 text-sm">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                      {new Date(brand.createdAt).toLocaleDateString("he-IL")}
                    </div>
                  </div>
                )}
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
