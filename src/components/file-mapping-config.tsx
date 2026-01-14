"use client";

import { useState, useEffect } from "react";
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  FileSpreadsheet,
  Plus,
  X,
  Save,
  Trash2,
  Loader2,
  AlertCircle,
  CheckCircle,
} from "lucide-react";
import type { SupplierFileMapping, SupplierFileType } from "@/db/schema";
import { he } from "@/lib/translations/he";

// Translation shorthand
const t = he.components.fileMappingConfig;

interface FileMappingConfigProps {
  supplierId: string;
  initialFileMapping?: SupplierFileMapping | null;
  onSave?: (fileMapping: SupplierFileMapping | null) => void;
  disabled?: boolean;
}

const initialFormState: SupplierFileMapping = {
  fileType: "xlsx",
  columnMappings: {
    franchiseeColumn: "",
    amountColumn: "",
    dateColumn: "",
  },
  headerRow: 1,
  dataStartRow: 2,
  rowsToSkip: undefined,
  skipKeywords: [],
};

export function FileMappingConfig({
  supplierId,
  initialFileMapping,
  onSave,
  disabled = false,
}: FileMappingConfigProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [formData, setFormData] = useState<SupplierFileMapping>(
    initialFileMapping || initialFormState
  );
  const [newKeyword, setNewKeyword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    if (initialFileMapping) {
      setFormData(initialFileMapping);
    }
  }, [initialFileMapping]);

  const handleAddKeyword = () => {
    const keyword = newKeyword.trim();
    const currentKeywords = formData.skipKeywords || [];
    if (keyword && !currentKeywords.includes(keyword)) {
      setFormData({
        ...formData,
        skipKeywords: [...currentKeywords, keyword],
      });
      setNewKeyword("");
    }
  };

  const handleRemoveKeyword = (keyword: string) => {
    const currentKeywords = formData.skipKeywords || [];
    setFormData({
      ...formData,
      skipKeywords: currentKeywords.filter((k) => k !== keyword),
    });
  };

  const handleSave = async () => {
    try {
      setIsSubmitting(true);
      setMessage(null);

      const response = await fetch(
        `/api/suppliers/${supplierId}/file-mapping`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.details?.join(", ") || data.error || t.messages.saveError
        );
      }

      setMessage({ type: "success", text: t.messages.saveSuccess });
      onSave?.(data.fileMapping);
    } catch (error) {
      console.error("Error saving file mapping:", error);
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : t.messages.saveError,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(t.messages.deleteConfirm)) {
      return;
    }

    try {
      setIsSubmitting(true);
      setMessage(null);

      const response = await fetch(
        `/api/suppliers/${supplierId}/file-mapping`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || t.messages.deleteError);
      }

      setFormData(initialFormState);
      setMessage({ type: "success", text: t.messages.deleteSuccess });
      onSave?.(null);
    } catch (error) {
      console.error("Error deleting file mapping:", error);
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : t.messages.deleteError,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasFileMapping = initialFileMapping !== null && initialFileMapping !== undefined;

  return (
    <Card className="mt-4">
      <CardHeader
        className="cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            <CardTitle className="text-lg">{t.title}</CardTitle>
            {hasFileMapping && (
              <Badge variant="outline" className="mr-2">
                {t.configured}
              </Badge>
            )}
          </div>
          <Button variant="ghost" size="sm">
            {isExpanded ? t.collapse : t.expand}
          </Button>
        </div>
        <CardDescription>
          {t.description}
        </CardDescription>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-6">
          {message && (
            <div
              className={`flex items-center gap-2 p-3 rounded-lg ${
                message.type === "success"
                  ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                  : "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
              }`}
            >
              {message.type === "success" ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
              <span className="text-sm">{message.text}</span>
            </div>
          )}

          {/* File Type */}
          <div className="space-y-2">
            <Label htmlFor="fileType">{t.fileType.label}</Label>
            <Select
              value={formData.fileType}
              onValueChange={(value: SupplierFileType) =>
                setFormData({ ...formData, fileType: value })
              }
              disabled={disabled || isSubmitting}
            >
              <SelectTrigger id="fileType" className="w-full max-w-xs">
                <SelectValue placeholder={t.fileType.placeholder} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="xlsx">{t.fileType.xlsx}</SelectItem>
                <SelectItem value="xls">{t.fileType.xls}</SelectItem>
                <SelectItem value="csv">{t.fileType.csv}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Column Mappings */}
          <div className="space-y-4">
            <h4 className="font-medium">{t.columnMappings.title}</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="franchiseeColumn">{t.columnMappings.franchiseeColumn.label}</Label>
                <Input
                  id="franchiseeColumn"
                  value={formData.columnMappings.franchiseeColumn}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      columnMappings: {
                        ...formData.columnMappings,
                        franchiseeColumn: e.target.value,
                      },
                    })
                  }
                  placeholder={t.columnMappings.franchiseeColumn.placeholder}
                  disabled={disabled || isSubmitting}
                  dir="ltr"
                />
                <p className="text-xs text-muted-foreground">
                  {t.columnMappings.franchiseeColumn.description}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="amountColumn">{t.columnMappings.amountColumn.label}</Label>
                <Input
                  id="amountColumn"
                  value={formData.columnMappings.amountColumn}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      columnMappings: {
                        ...formData.columnMappings,
                        amountColumn: e.target.value,
                      },
                    })
                  }
                  placeholder={t.columnMappings.amountColumn.placeholder}
                  disabled={disabled || isSubmitting}
                  dir="ltr"
                />
                <p className="text-xs text-muted-foreground">
                  {t.columnMappings.amountColumn.description}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="dateColumn">{t.columnMappings.dateColumn.label}</Label>
                <Input
                  id="dateColumn"
                  value={formData.columnMappings.dateColumn}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      columnMappings: {
                        ...formData.columnMappings,
                        dateColumn: e.target.value,
                      },
                    })
                  }
                  placeholder={t.columnMappings.dateColumn.placeholder}
                  disabled={disabled || isSubmitting}
                  dir="ltr"
                />
                <p className="text-xs text-muted-foreground">
                  {t.columnMappings.dateColumn.description}
                </p>
              </div>
            </div>
          </div>

          {/* Row Configuration */}
          <div className="space-y-4">
            <h4 className="font-medium">{t.rowConfig.title}</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="headerRow">{t.rowConfig.headerRow.label}</Label>
                <Input
                  id="headerRow"
                  type="number"
                  min="1"
                  value={formData.headerRow}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      headerRow: parseInt(e.target.value) || 1,
                    })
                  }
                  disabled={disabled || isSubmitting}
                  dir="ltr"
                />
                <p className="text-xs text-muted-foreground">
                  {t.rowConfig.headerRow.description}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="dataStartRow">{t.rowConfig.dataStartRow.label}</Label>
                <Input
                  id="dataStartRow"
                  type="number"
                  min="1"
                  value={formData.dataStartRow}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      dataStartRow: parseInt(e.target.value) || 2,
                    })
                  }
                  disabled={disabled || isSubmitting}
                  dir="ltr"
                />
                <p className="text-xs text-muted-foreground">
                  {t.rowConfig.dataStartRow.description}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="rowsToSkip">{t.rowConfig.rowsToSkip.label}</Label>
                <Input
                  id="rowsToSkip"
                  type="number"
                  min="0"
                  value={formData.rowsToSkip ?? ""}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      rowsToSkip: e.target.value
                        ? parseInt(e.target.value)
                        : undefined,
                    })
                  }
                  placeholder={t.rowConfig.rowsToSkip.placeholder}
                  disabled={disabled || isSubmitting}
                  dir="ltr"
                />
                <p className="text-xs text-muted-foreground">
                  {t.rowConfig.rowsToSkip.description}
                </p>
              </div>
            </div>
          </div>

          {/* Skip Keywords */}
          <div className="space-y-4">
            <h4 className="font-medium">{t.skipKeywords.title}</h4>
            <p className="text-sm text-muted-foreground">
              {t.skipKeywords.description}
            </p>
            <div className="flex flex-wrap gap-2 mb-2">
              {(formData.skipKeywords || []).map((keyword) => (
                <Badge
                  key={keyword}
                  variant="secondary"
                  className="flex items-center gap-1"
                >
                  {keyword}
                  <button
                    onClick={() => handleRemoveKeyword(keyword)}
                    disabled={disabled || isSubmitting}
                    className="mr-1 hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              {(formData.skipKeywords || []).length === 0 && (
                <span className="text-sm text-muted-foreground">
                  {t.skipKeywords.noKeywords}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddKeyword();
                  }
                }}
                placeholder={t.skipKeywords.placeholder}
                disabled={disabled || isSubmitting}
                className="max-w-xs"
                dir="auto"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddKeyword}
                disabled={disabled || isSubmitting || !newKeyword.trim()}
              >
                <Plus className="h-4 w-4 ml-1" />
                {t.skipKeywords.addButton}
              </Button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-start gap-2 pt-4 border-t">
            {hasFileMapping && (
              <Button
                type="button"
                variant="destructive"
                onClick={handleDelete}
                disabled={disabled || isSubmitting}
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 ml-1 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 ml-1" />
                )}
                {t.actions.removeConfiguration}
              </Button>
            )}
            <Button
              type="button"
              onClick={handleSave}
              disabled={disabled || isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 ml-1 animate-spin" />
              ) : (
                <Save className="h-4 w-4 ml-1" />
              )}
              {t.actions.saveConfiguration}
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
