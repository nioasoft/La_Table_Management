"use client";

import { useState, useEffect, useCallback, use } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Upload,
  FileIcon,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  CloudUpload,
} from "lucide-react";
import { he } from "@/lib/translations/he";

// Types
interface UploadLinkInfo {
  id: string;
  name: string;
  description: string | null;
  entityType: string;
  entityName: string | null;
  allowedFileTypes: string[];
  maxFileSize: number;
  maxFiles: number;
  filesUploaded: number;
  expiresAt: string | null;
}

interface UploadedFileInfo {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

type PageStatus = "loading" | "ready" | "uploading" | "success" | "error";

// Helper to format file size
function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// Helper to get file type label
function getFileTypeLabel(mimeType: string): string {
  const labels: Record<string, string> = {
    "application/pdf": "PDF",
    "application/msword": "Word",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
    "application/vnd.ms-excel": "Excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
    "image/jpeg": "JPEG",
    "image/png": "PNG",
    "image/gif": "GIF",
    "text/plain": "Text",
    "text/csv": "CSV",
  };
  return labels[mimeType] || mimeType.split("/")[1]?.toUpperCase() || mimeType;
}

// Helper to get entity type label in Hebrew
function getEntityTypeLabel(entityType: string): string {
  const labels = he.upload.entityTypes;
  return labels[entityType as keyof typeof labels] || entityType;
}

export default function PublicUploadPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);

  const [status, setStatus] = useState<PageStatus>("loading");
  const [uploadLinkInfo, setUploadLinkInfo] = useState<UploadLinkInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploaderEmail, setUploaderEmail] = useState<string>("");
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFileInfo[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [filesRemaining, setFilesRemaining] = useState(0);

  // Fetch upload link info
  useEffect(() => {
    async function fetchUploadLink() {
      try {
        const response = await fetch(`/api/public/upload/${token}`);
        const data = await response.json();

        if (!response.ok) {
          setErrorMessage(data.error || he.upload.invalidLink);
          setStatus("error");
          return;
        }

        setUploadLinkInfo(data.uploadLink);
        setFilesRemaining(data.uploadLink.maxFiles - data.uploadLink.filesUploaded);
        setStatus("ready");
      } catch (error) {
        console.error("Error fetching upload link:", error);
        setErrorMessage(he.upload.loadingError);
        setStatus("error");
      }
    }

    fetchUploadLink();
  }, [token]);

  // Handle file selection
  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file && uploadLinkInfo) {
        // Validate file type
        if (!uploadLinkInfo.allowedFileTypes.includes(file.type)) {
          setErrorMessage(he.upload.errors.invalidFileType);
          return;
        }
        // Validate file size
        if (file.size > uploadLinkInfo.maxFileSize) {
          setErrorMessage(
            he.upload.errors.fileTooLarge.replace("{maxSize}", formatFileSize(uploadLinkInfo.maxFileSize))
          );
          return;
        }
        setErrorMessage("");
        setSelectedFile(file);
      }
    },
    [uploadLinkInfo]
  );

  // Handle drag events
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const file = e.dataTransfer.files?.[0];
      if (file && uploadLinkInfo) {
        // Validate file type
        if (!uploadLinkInfo.allowedFileTypes.includes(file.type)) {
          setErrorMessage(he.upload.errors.invalidFileType);
          return;
        }
        // Validate file size
        if (file.size > uploadLinkInfo.maxFileSize) {
          setErrorMessage(
            he.upload.errors.fileTooLarge.replace("{maxSize}", formatFileSize(uploadLinkInfo.maxFileSize))
          );
          return;
        }
        setErrorMessage("");
        setSelectedFile(file);
      }
    },
    [uploadLinkInfo]
  );

  // Handle file upload
  const handleUpload = async () => {
    if (!selectedFile || !uploadLinkInfo) return;

    setStatus("uploading");
    setErrorMessage("");

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      if (uploaderEmail) {
        formData.append("email", uploaderEmail);
      }

      const response = await fetch(`/api/public/upload/${token}`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        setErrorMessage(data.error || he.upload.errors.uploadFailed);
        setStatus("ready");
        return;
      }

      // Add to uploaded files list
      setUploadedFiles((prev) => [...prev, data.file]);
      setFilesRemaining(data.filesRemaining);
      setSelectedFile(null);

      // If no more files can be uploaded, show success
      if (data.filesRemaining <= 0) {
        setStatus("success");
      } else {
        setStatus("ready");
      }
    } catch (error) {
      console.error("Error uploading file:", error);
      setErrorMessage(he.upload.errors.uploadFailed);
      setStatus("ready");
    }
  };

  // Remove selected file
  const handleRemoveFile = () => {
    setSelectedFile(null);
    setErrorMessage("");
  };

  // Loading state
  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 bg-muted/30">
        <Card className="w-full max-w-lg">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
            <p className="text-muted-foreground">{he.upload.loading}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Error state
  if (status === "error" && !uploadLinkInfo) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 bg-muted/30">
        <Card className="w-full max-w-lg">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="h-12 w-12 text-destructive mb-4" />
            <h2 className="text-xl font-semibold mb-2">{he.upload.error}</h2>
            <p className="text-muted-foreground text-center">{errorMessage}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Success state (all files uploaded)
  if (status === "success") {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 bg-muted/30">
        <Card className="w-full max-w-lg">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <CheckCircle2 className="h-16 w-16 text-green-500 mb-4" />
            <h2 className="text-2xl font-semibold mb-2">{he.upload.success.title}</h2>
            <p className="text-muted-foreground text-center mb-6">
              {he.upload.success.message}
            </p>
            {uploadedFiles.length > 0 && (
              <div className="w-full space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground">{he.upload.success.uploadedFiles}</h3>
                {uploadedFiles.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center gap-2 p-3 bg-muted rounded-lg"
                  >
                    <FileIcon className="h-5 w-5 text-muted-foreground" />
                    <span className="flex-1 text-sm truncate">{file.fileName}</span>
                    <Badge variant="secondary">{formatFileSize(file.fileSize)}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Ready/Uploading state
  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-muted/30">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">{uploadLinkInfo?.name}</CardTitle>
          {uploadLinkInfo?.description && (
            <CardDescription>{uploadLinkInfo.description}</CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Request info */}
          <div className="rounded-lg border p-4 bg-muted/50">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{he.upload.info.for}</span>
                <span className="font-medium">
                  {uploadLinkInfo?.entityName || he.common.notApplicable} (
                  {getEntityTypeLabel(uploadLinkInfo?.entityType || "")})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{he.upload.info.filesToUpload}</span>
                <span className="font-medium">
                  {filesRemaining} {he.common.of} {uploadLinkInfo?.maxFiles}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{he.upload.info.maxSize}</span>
                <span className="font-medium">
                  {formatFileSize(uploadLinkInfo?.maxFileSize || 0)}
                </span>
              </div>
              {uploadLinkInfo?.expiresAt && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{he.upload.info.validUntil}</span>
                  <span className="font-medium">
                    {new Date(uploadLinkInfo.expiresAt).toLocaleDateString("he-IL")}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Allowed file types */}
          <div>
            <p className="text-sm text-muted-foreground mb-2">{he.upload.info.allowedTypes}</p>
            <div className="flex flex-wrap gap-1">
              {uploadLinkInfo?.allowedFileTypes.map((type) => (
                <Badge key={type} variant="outline" className="text-xs">
                  {getFileTypeLabel(type)}
                </Badge>
              ))}
            </div>
          </div>

          {/* Error message */}
          {errorMessage && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
              <p className="text-sm text-destructive flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                {errorMessage}
              </p>
            </div>
          )}

          {/* Already uploaded files */}
          {uploadedFiles.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">
                {he.upload.success.uploadedFiles}
              </h3>
              {uploadedFiles.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-900"
                >
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  <span className="flex-1 text-sm truncate">{file.fileName}</span>
                  <Badge variant="secondary">{formatFileSize(file.fileSize)}</Badge>
                </div>
              ))}
            </div>
          )}

          {/* File upload area */}
          {filesRemaining > 0 && (
            <>
              <div
                className={`
                  relative rounded-lg border-2 border-dashed p-8 transition-colors
                  ${isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25"}
                  ${selectedFile ? "bg-muted/50" : ""}
                `}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                {selectedFile ? (
                  <div className="flex flex-col items-center gap-3">
                    <FileIcon className="h-12 w-12 text-primary" />
                    <div className="text-center">
                      <p className="font-medium">{selectedFile.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatFileSize(selectedFile.size)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleRemoveFile}
                      className="text-destructive hover:text-destructive"
                    >
                      <X className="h-4 w-4 ml-1" />
                      {he.upload.fileUpload.removeFile}
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 text-center">
                    <CloudUpload className="h-12 w-12 text-muted-foreground" />
                    <div>
                      <p className="font-medium">{he.upload.fileUpload.dragHere}</p>
                      <p className="text-sm text-muted-foreground">{he.upload.fileUpload.orClick}</p>
                    </div>
                    <Input
                      type="file"
                      className="absolute inset-0 cursor-pointer opacity-0"
                      onChange={handleFileChange}
                      accept={uploadLinkInfo?.allowedFileTypes.join(",")}
                      disabled={status === "uploading"}
                    />
                  </div>
                )}
              </div>

              {/* Email input (optional) */}
              <div className="space-y-2">
                <Label htmlFor="email">{he.upload.email.label}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder={he.upload.email.placeholder}
                  value={uploaderEmail}
                  onChange={(e) => setUploaderEmail(e.target.value)}
                  disabled={status === "uploading"}
                  dir="ltr"
                />
                <p className="text-xs text-muted-foreground">
                  {he.upload.email.hint}
                </p>
              </div>

              {/* Upload button */}
              <Button
                className="w-full"
                size="lg"
                onClick={handleUpload}
                disabled={!selectedFile || status === "uploading"}
              >
                {status === "uploading" ? (
                  <>
                    <Loader2 className="h-5 w-5 ml-2 animate-spin" />
                    {he.upload.fileUpload.uploading}
                  </>
                ) : (
                  <>
                    <Upload className="h-5 w-5 ml-2" />
                    {he.upload.fileUpload.uploadButton}
                  </>
                )}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
