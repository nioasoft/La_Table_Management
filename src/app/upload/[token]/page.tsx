"use client";

import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
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

/**
 * Infer a MIME type from a filename extension.
 *
 * Chrome on Windows in particular often reports `BKMVDATA.txt` as
 * `application/octet-stream` (or an empty MIME type), which causes the
 * client-side validator to reject the file before it ever reaches the
 * server. This helper lets us fall back on the extension when the browser
 * has not given us a usable MIME type. The server still validates the
 * actual content via magic-byte detection, so this is purely a UX fix.
 */
function inferMimeFromName(name: string): string | null {
  const ext = name.toLowerCase().split(".").pop();
  if (!ext) return null;
  const map: Record<string, string> = {
    txt: "text/plain",
    csv: "text/csv",
    pdf: "application/pdf",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    // .xlsm (macro) and .xlsb (binary) are OOXML/Excel variants. Some
    // POS/ERP exports produce these; map them to the standard xlsx MIME so
    // they pass the client picker/validation. The server magic-byte check
    // stays authoritative and returns a clear error if it can't read them.
    xlsm: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xlsb: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
  };
  return map[ext] ?? null;
}

/**
 * Build the file input's `accept` attribute from the link's allowed MIME
 * types PLUS explicit extensions.
 *
 * Windows file dialogs apply a MIME-only `accept` strictly and gray out files
 * whose registered type doesn't map to those MIME strings (e.g. `.xlsm`,
 * `.xlsb`, or an HTML table saved as `.xls`) — so the supplier can't even
 * select the file and the upload silently does nothing. Adding extensions
 * makes the picker reliably allow every Excel/CSV variant.
 */
function buildAcceptAttr(mimeTypes: string[]): string {
  const mimeToExtensions: Record<string, string[]> = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
      ".xlsx",
      ".xlsm",
      ".xlsb",
    ],
    "application/vnd.ms-excel": [".xls"],
    "text/csv": [".csv"],
    "application/csv": [".csv"],
    "application/pdf": [".pdf"],
    "text/plain": [".txt"],
    "application/msword": [".doc"],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
      ".docx",
    ],
    "image/jpeg": [".jpg", ".jpeg"],
    "image/png": [".png"],
    "image/gif": [".gif"],
  };
  const extensions = new Set<string>();
  for (const mime of mimeTypes) {
    for (const ext of mimeToExtensions[mime] ?? []) extensions.add(ext);
  }
  return [...mimeTypes, ...extensions].join(",");
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
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploaderEmail, setUploaderEmail] = useState<string>("");
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFileInfo[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [filesRemaining, setFilesRemaining] = useState(0);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [duplicateInfo, setDuplicateInfo] = useState<{
    file: File;
    existingFileId: string;
    existingFileName: string;
  } | null>(null);

  // Fetch upload link info
  useEffect(() => {
    async function fetchUploadLink() {
      try {
        const response = await fetchWithTimeout(`/api/public/upload/${token}`);
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

  // Validate and add files to selection
  const addFiles = useCallback(
    (newFiles: FileList | File[]) => {
      if (!uploadLinkInfo) return;

      const filesToAdd: File[] = [];
      const maxAllowed = filesRemaining - selectedFiles.length;

      for (let i = 0; i < newFiles.length && filesToAdd.length < maxAllowed; i++) {
        const file = newFiles[i];

        // Validate file type. Browsers — especially Chrome on Windows —
        // sometimes report a `BKMVDATA.txt` file with an empty MIME or
        // `application/octet-stream`. Treat those as the extension-implied
        // type so legitimate uploads aren't blocked at the picker. The
        // server still verifies content via magic-byte checks.
        const inferredType =
          !file.type || file.type === "application/octet-stream"
            ? inferMimeFromName(file.name) ?? file.type
            : file.type;
        if (
          !uploadLinkInfo.allowedFileTypes.includes(inferredType) &&
          !uploadLinkInfo.allowedFileTypes.includes(file.type)
        ) {
          setErrorMessage(he.upload.errors.invalidFileType);
          continue;
        }
        // Validate file size
        if (file.size > uploadLinkInfo.maxFileSize) {
          setErrorMessage(
            he.upload.errors.fileTooLarge.replace("{maxSize}", formatFileSize(uploadLinkInfo.maxFileSize))
          );
          continue;
        }
        // Avoid duplicates
        const isDuplicate = selectedFiles.some(
          (f) => f.name === file.name && f.size === file.size
        );
        if (isDuplicate) continue;

        filesToAdd.push(file);
      }

      if (newFiles.length > maxAllowed + filesToAdd.length) {
        setErrorMessage(
          he.upload.fileUpload.tooManyFiles.replace("{remaining}", String(maxAllowed))
        );
      }

      if (filesToAdd.length > 0) {
        setErrorMessage("");
        setSelectedFiles((prev) => [...prev, ...filesToAdd]);
      }
    },
    [uploadLinkInfo, filesRemaining, selectedFiles]
  );

  // Handle file selection via input
  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        addFiles(files);
      }
      // Reset input so the same files can be re-selected
      e.target.value = "";
    },
    [addFiles]
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

      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        addFiles(files);
      }
    },
    [addFiles]
  );

  // Upload a single file, optionally replacing an existing one
  const uploadSingleFile = async (
    file: File,
    replaceFileId?: string
  ): Promise<{ success: boolean; duplicate?: { existingFileId: string; existingFileName: string }; error?: string; code?: string }> => {
    const formData = new FormData();
    formData.append("file", file);
    if (uploaderEmail) {
      formData.append("email", uploaderEmail);
    }
    if (replaceFileId) {
      formData.append("replaceFileId", replaceFileId);
    }

    const response = await fetchWithTimeout(`/api/public/upload/${token}`, {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (response.status === 409 && data.code === "DUPLICATE_FILE") {
      // File uploaded to storage, but duplicate detected - ask user to confirm
      return {
        success: false,
        duplicate: {
          existingFileId: data.duplicate.existingFileId,
          existingFileName: data.duplicate.existingFileName,
        },
      };
    }

    if (!response.ok) {
      return { success: false, error: data.error || he.upload.errors.uploadFailed, code: data.code };
    }

    // Success
    setUploadedFiles((prev) => [...prev, data.file]);
    setFilesRemaining(data.filesRemaining);
    return { success: true };
  };

  // Handle file upload - uploads files sequentially
  const handleUpload = async () => {
    if (selectedFiles.length === 0 || !uploadLinkInfo) return;

    setStatus("uploading");
    setErrorMessage("");
    setDuplicateInfo(null);
    setUploadProgress({ current: 0, total: selectedFiles.length });

    const failedFiles: string[] = [];
    const remainingFiles: File[] = [];

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      setUploadProgress({ current: i + 1, total: selectedFiles.length });

      try {
        const result = await uploadSingleFile(file);

        if (result.duplicate) {
          // Pause and ask user about this duplicate
          setUploadProgress(null);
          setDuplicateInfo({
            file,
            existingFileId: result.duplicate.existingFileId,
            existingFileName: result.duplicate.existingFileName,
          });
          // Keep remaining files for after the duplicate is resolved
          remainingFiles.push(...selectedFiles.slice(i + 1));
          setSelectedFiles(remainingFiles);
          setStatus("ready");
          return;
        }

        if (result.error) {
          failedFiles.push(
            `${file.name}: ${result.error}${result.code ? ` (קוד: ${result.code})` : ""}`
          );
        }
      } catch (error) {
        console.error("Error uploading file:", error);
        failedFiles.push(`${file.name}: ${he.upload.errors.uploadFailed}`);
      }
    }

    setSelectedFiles([]);
    setUploadProgress(null);

    if (failedFiles.length > 0) {
      setErrorMessage(failedFiles.join("\n"));
      setStatus("ready");
    } else if (filesRemaining <= 0) {
      setStatus("success");
    } else {
      setStatus("ready");
    }
  };

  // Handle duplicate replacement confirmation
  const handleDuplicateReplace = async () => {
    if (!duplicateInfo) return;

    setStatus("uploading");
    setErrorMessage("");
    const { file, existingFileId } = duplicateInfo;
    setDuplicateInfo(null);

    try {
      const result = await uploadSingleFile(file, existingFileId);
      if (result.error) {
        setErrorMessage(
          `${file.name}: ${result.error}${result.code ? ` (קוד: ${result.code})` : ""}`
        );
      }
    } catch (error) {
      console.error("Error replacing file:", error);
      setErrorMessage(`${file.name}: ${he.upload.errors.uploadFailed}`);
    }

    setStatus("ready");

    // Continue uploading remaining files if any
    if (selectedFiles.length > 0) {
      // Use setTimeout to let state settle before continuing
      setTimeout(() => handleUpload(), 100);
    }
  };

  // Cancel duplicate replacement
  const handleDuplicateCancel = () => {
    setDuplicateInfo(null);
  };

  // Remove a specific selected file
  const handleRemoveFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
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
              <p className="text-sm text-destructive flex items-center gap-2 whitespace-pre-line">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {errorMessage}
              </p>
            </div>
          )}

          {/* Duplicate file confirmation */}
          {duplicateInfo && (
            <div className="rounded-lg border border-yellow-500/50 bg-yellow-50 dark:bg-yellow-950/20 p-4 space-y-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-yellow-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                    {he.upload.duplicate.title}
                  </p>
                  <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                    {he.upload.duplicate.message.replace("{fileName}", duplicateInfo.existingFileName)}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDuplicateCancel}
                >
                  {he.upload.duplicate.cancel}
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleDuplicateReplace}
                >
                  {he.upload.duplicate.replace}
                </Button>
              </div>
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
                  ${selectedFiles.length > 0 ? "bg-muted/50" : ""}
                `}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                {selectedFiles.length > 0 ? (
                  <div className="space-y-3">
                    {selectedFiles.map((file, index) => (
                      <div
                        key={`${file.name}-${file.size}`}
                        className="flex items-center gap-2 p-2 bg-background rounded-md border"
                      >
                        <FileIcon className="h-5 w-5 text-primary shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{file.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatFileSize(file.size)}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive shrink-0"
                          onClick={() => handleRemoveFile(index)}
                          disabled={status === "uploading"}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    {/* Allow adding more files if there are remaining slots */}
                    {selectedFiles.length < filesRemaining && (
                      <label className="flex items-center justify-center gap-2 p-2 rounded-md border border-dashed cursor-pointer text-sm text-muted-foreground hover:text-foreground hover:border-foreground/25 transition-colors">
                        <CloudUpload className="h-4 w-4" />
                        <span>{he.upload.fileUpload.orClick}</span>
                        <input
                          type="file"
                          className="hidden"
                          onChange={handleFileChange}
                          accept={
                            uploadLinkInfo
                              ? buildAcceptAttr(uploadLinkInfo.allowedFileTypes)
                              : undefined
                          }
                          disabled={status === "uploading"}
                          multiple
                        />
                      </label>
                    )}
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
                      accept={
                        uploadLinkInfo
                          ? buildAcceptAttr(uploadLinkInfo.allowedFileTypes)
                          : undefined
                      }
                      disabled={status === "uploading"}
                      multiple
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
                disabled={selectedFiles.length === 0 || status === "uploading"}
              >
                {status === "uploading" && uploadProgress ? (
                  <>
                    <Loader2 className="h-5 w-5 ml-2 animate-spin" />
                    {he.upload.fileUpload.uploadProgress
                      .replace("{current}", String(uploadProgress.current))
                      .replace("{total}", String(uploadProgress.total))}
                  </>
                ) : (
                  <>
                    <Upload className="h-5 w-5 ml-2" />
                    {selectedFiles.length === 1
                      ? he.upload.fileUpload.uploadButtonSingle
                      : `${he.upload.fileUpload.uploadButton} (${selectedFiles.length})`}
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
