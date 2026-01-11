"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  FileText,
  Upload,
  Download,
  Trash2,
  Loader2,
  File,
  FileSpreadsheet,
  Image,
  X,
  Plus,
  Calendar,
  User,
  Pencil,
} from "lucide-react";
import type { Document, DocumentStatus } from "@/db/schema";
import { he } from "@/lib/translations/he";

const t = he.components.documentManager;

// Document type options
const DOCUMENT_TYPES = [
  { value: "agreement", label: t.documentTypes.agreement },
  { value: "correspondence", label: t.documentTypes.correspondence },
  { value: "invoice", label: t.documentTypes.invoice },
  { value: "other", label: t.documentTypes.other },
] as const;

type DocumentType = (typeof DOCUMENT_TYPES)[number]["value"];

// Extended document type with uploader info
interface DocumentWithUploader extends Document {
  uploaderName?: string | null;
  uploaderEmail?: string | null;
}

interface DocumentManagerProps {
  entityType: "supplier" | "franchisee" | "brand";
  entityId: string;
  entityName: string;
  documents: DocumentWithUploader[];
  onDocumentsChange: (documents: DocumentWithUploader[]) => void;
  canUpload?: boolean;
  canDelete?: boolean;
  canEdit?: boolean;
}

// Get icon based on file type
function getFileIcon(mimeType: string | null) {
  if (!mimeType) return <File className="h-5 w-5" />;

  if (mimeType.includes("pdf")) {
    return <FileText className="h-5 w-5 text-red-500" />;
  }
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || mimeType.includes("csv")) {
    return <FileSpreadsheet className="h-5 w-5 text-green-500" />;
  }
  if (mimeType.includes("image")) {
    return <Image className="h-5 w-5 text-blue-500" />;
  }
  if (mimeType.includes("word") || mimeType.includes("document")) {
    return <FileText className="h-5 w-5 text-blue-600" />;
  }
  return <File className="h-5 w-5" />;
}

// Format file size
function formatFileSize(bytes: number | null): string {
  if (!bytes) return t.unknownSize;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Get document type label
function getDocumentTypeLabel(type: string): string {
  const docType = DOCUMENT_TYPES.find((dt) => dt.value === type);
  return docType?.label || type;
}

// Get status label in Hebrew
function getStatusLabel(status: DocumentStatus): string {
  const statusLabels: Record<DocumentStatus, string> = {
    active: t.statuses.active,
    draft: t.statuses.draft,
    expired: t.statuses.expired,
    archived: t.statuses.archived,
  };
  return statusLabels[status] || status;
}

// Get status badge variant
function getStatusBadgeVariant(status: DocumentStatus): "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info" {
  switch (status) {
    case "active":
      return "success";
    case "draft":
      return "secondary";
    case "expired":
      return "destructive";
    case "archived":
      return "outline";
    default:
      return "default";
  }
}

export function DocumentManager({
  entityType,
  entityId,
  entityName,
  documents,
  onDocumentsChange,
  canUpload = true,
  canDelete = true,
  canEdit = true,
}: DocumentManagerProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingDocument, setEditingDocument] = useState<DocumentWithUploader | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Upload form state
  const [uploadForm, setUploadForm] = useState({
    name: "",
    description: "",
    documentType: "other" as DocumentType,
    file: null as File | null,
  });

  // Edit form state
  const [editForm, setEditForm] = useState({
    name: "",
    description: "",
    documentType: "" as DocumentType,
    status: "active" as DocumentStatus,
  });

  // Reset upload form
  const resetUploadForm = useCallback(() => {
    setUploadForm({
      name: "",
      description: "",
      documentType: "other",
      file: null,
    });
    setUploadError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  // Handle file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadForm((prev) => ({
        ...prev,
        file,
        name: prev.name || file.name.replace(/\.[^/.]+$/, ""),
      }));
      setUploadError(null);
    }
  };

  // Handle upload
  const handleUpload = async () => {
    if (!uploadForm.file) {
      setUploadError(t.errors.selectFile);
      return;
    }

    if (!uploadForm.name.trim()) {
      setUploadError(t.errors.enterName);
      return;
    }

    setIsUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append("file", uploadForm.file);
      formData.append("name", uploadForm.name.trim());
      formData.append("description", uploadForm.description.trim());
      formData.append("documentType", uploadForm.documentType);

      const response = await fetch(`/api/documents/${entityType}/${entityId}`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to upload document");
      }

      const data = await response.json();
      onDocumentsChange([data.document, ...documents]);
      setIsUploadDialogOpen(false);
      resetUploadForm();
    } catch (error) {
      console.error("Upload error:", error);
      setUploadError(error instanceof Error ? error.message : "Failed to upload document");
    } finally {
      setIsUploading(false);
    }
  };

  // Handle edit
  const handleEdit = async () => {
    if (!editingDocument) return;

    if (!editForm.name.trim()) {
      return;
    }

    setIsEditing(true);

    try {
      const response = await fetch(`/api/documents/item/${editingDocument.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: editForm.name.trim(),
          description: editForm.description.trim(),
          documentType: editForm.documentType,
          status: editForm.status,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update document");
      }

      const data = await response.json();
      onDocumentsChange(
        documents.map((doc) =>
          doc.id === editingDocument.id ? data.document : doc
        )
      );
      setIsEditDialogOpen(false);
      setEditingDocument(null);
    } catch (error) {
      console.error("Edit error:", error);
    } finally {
      setIsEditing(false);
    }
  };

  // Handle delete
  const handleDelete = async (documentId: string) => {
    setIsDeleting(true);

    try {
      const response = await fetch(`/api/documents/item/${documentId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to delete document");
      }

      onDocumentsChange(documents.filter((doc) => doc.id !== documentId));
      setDeleteConfirmId(null);
    } catch (error) {
      console.error("Delete error:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  // Open edit dialog
  const openEditDialog = (document: DocumentWithUploader) => {
    setEditingDocument(document);
    setEditForm({
      name: document.name,
      description: document.description || "",
      documentType: document.documentType as DocumentType,
      status: document.status,
    });
    setIsEditDialogOpen(true);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {t.title}
            </CardTitle>
            <CardDescription>
              {t.manageDocuments.replace("{entityName}", entityName)}
            </CardDescription>
          </div>
          {canUpload && (
            <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={resetUploadForm}>
                  <Plus className="h-4 w-4 ml-2" />
                  {t.uploadDocument}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t.uploadDialog.title}</DialogTitle>
                  <DialogDescription>
                    {t.uploadDialog.description.replace("{entityName}", entityName)}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="file">{t.uploadDialog.fileLabel}</Label>
                    <Input
                      id="file"
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileSelect}
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.txt,.csv"
                    />
                    {uploadForm.file && (
                      <p className="text-sm text-muted-foreground">
                        {t.uploadDialog.selected
                          .replace("{fileName}", uploadForm.file.name)
                          .replace("{fileSize}", formatFileSize(uploadForm.file.size))}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="name">{t.uploadDialog.nameLabel}</Label>
                    <Input
                      id="name"
                      value={uploadForm.name}
                      onChange={(e) =>
                        setUploadForm((prev) => ({ ...prev, name: e.target.value }))
                      }
                      placeholder={t.uploadDialog.namePlaceholder}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="documentType">{t.uploadDialog.typeLabel}</Label>
                    <Select
                      value={uploadForm.documentType}
                      onValueChange={(value) =>
                        setUploadForm((prev) => ({ ...prev, documentType: value as DocumentType }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t.uploadDialog.typePlaceholder} />
                      </SelectTrigger>
                      <SelectContent>
                        {DOCUMENT_TYPES.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">{t.uploadDialog.descriptionLabel}</Label>
                    <Input
                      id="description"
                      value={uploadForm.description}
                      onChange={(e) =>
                        setUploadForm((prev) => ({ ...prev, description: e.target.value }))
                      }
                      placeholder={t.uploadDialog.descriptionPlaceholder}
                    />
                  </div>
                  {uploadError && (
                    <p className="text-sm text-destructive">{uploadError}</p>
                  )}
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setIsUploadDialogOpen(false)}
                    disabled={isUploading}
                  >
                    {he.common.cancel}
                  </Button>
                  <Button onClick={handleUpload} disabled={isUploading}>
                    {isUploading ? (
                      <>
                        <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                        {t.uploadDialog.uploading}
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4 ml-2" />
                        {t.uploadDialog.upload}
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>{t.noDocuments}</p>
            {canUpload && (
              <p className="text-sm mt-2">{t.clickToUpload}</p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-4">
                  {getFileIcon(doc.mimeType)}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{doc.name}</span>
                      <Badge variant={getStatusBadgeVariant(doc.status)}>
                        {getStatusLabel(doc.status)}
                      </Badge>
                      <Badge variant="outline">
                        {getDocumentTypeLabel(doc.documentType)}
                      </Badge>
                    </div>
                    {doc.description && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {doc.description}
                      </p>
                    )}
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(doc.createdAt).toLocaleDateString("he-IL")}
                      </span>
                      {doc.uploaderName && (
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {doc.uploaderName}
                        </span>
                      )}
                      <span>{formatFileSize(doc.fileSize)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {doc.fileUrl && (
                    <Button
                      variant="ghost"
                      size="icon"
                      asChild
                    >
                      <a
                        href={doc.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        download={doc.fileName}
                      >
                        <Download className="h-4 w-4" />
                      </a>
                    </Button>
                  )}
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEditDialog(doc)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                  {canDelete && (
                    <>
                      {deleteConfirmId === doc.id ? (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleDelete(doc.id)}
                            disabled={isDeleting}
                          >
                            {isDeleting ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              t.deleteConfirm
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteConfirmId(null)}
                            disabled={isDeleting}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteConfirmId(doc.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Edit Dialog */}
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t.editDialog.title}</DialogTitle>
              <DialogDescription>
                {t.editDialog.description}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-name">{t.uploadDialog.nameLabel}</Label>
                <Input
                  id="edit-name"
                  value={editForm.name}
                  onChange={(e) =>
                    setEditForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder={t.uploadDialog.namePlaceholder}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-documentType">{t.uploadDialog.typeLabel}</Label>
                <Select
                  value={editForm.documentType}
                  onValueChange={(value) =>
                    setEditForm((prev) => ({ ...prev, documentType: value as DocumentType }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t.uploadDialog.typePlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {DOCUMENT_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-status">{t.editDialog.statusLabel}</Label>
                <Select
                  value={editForm.status}
                  onValueChange={(value) =>
                    setEditForm((prev) => ({ ...prev, status: value as DocumentStatus }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t.editDialog.statusPlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">{t.statuses.active}</SelectItem>
                    <SelectItem value="draft">{t.statuses.draft}</SelectItem>
                    <SelectItem value="expired">{t.statuses.expired}</SelectItem>
                    <SelectItem value="archived">{t.statuses.archived}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-description">{t.uploadDialog.descriptionLabel}</Label>
                <Input
                  id="edit-description"
                  value={editForm.description}
                  onChange={(e) =>
                    setEditForm((prev) => ({ ...prev, description: e.target.value }))
                  }
                  placeholder={t.uploadDialog.descriptionPlaceholder}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsEditDialogOpen(false)}
                disabled={isEditing}
              >
                {he.common.cancel}
              </Button>
              <Button onClick={handleEdit} disabled={isEditing}>
                {isEditing ? (
                  <>
                    <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                    {t.editDialog.saving}
                  </>
                ) : (
                  t.editDialog.saveChanges
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
