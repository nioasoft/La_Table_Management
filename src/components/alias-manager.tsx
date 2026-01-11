"use client";

import * as React from "react";
import { X, Plus, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { he } from "@/lib/translations/he";

// Hebrew translations for the component
const t = he.components.aliasManager;

export interface AliasManagerProps {
  /**
   * Current list of aliases
   */
  aliases: string[];
  /**
   * Callback when aliases change
   */
  onChange: (aliases: string[]) => void;
  /**
   * Whether the component is disabled
   */
  disabled?: boolean;
  /**
   * Placeholder text for the input
   */
  placeholder?: string;
  /**
   * Maximum number of aliases allowed (0 = unlimited)
   */
  maxAliases?: number;
  /**
   * Custom class name for the container
   */
  className?: string;
}

/**
 * AliasManager component for managing franchisee aliases.
 * Provides a tag-style UI for adding and removing aliases with helpful examples.
 *
 * Used for matching during file processing when suppliers use different names
 * for the same franchisee.
 */
export function AliasManager({
  aliases,
  onChange,
  disabled = false,
  placeholder = t.placeholder,
  maxAliases = 0,
  className,
}: AliasManagerProps) {
  const [inputValue, setInputValue] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleAddAlias = () => {
    const trimmedValue = inputValue.trim();

    // Validate the alias
    if (!trimmedValue) return;
    if (aliases.includes(trimmedValue)) {
      // Alias already exists, clear input
      setInputValue("");
      return;
    }
    if (maxAliases > 0 && aliases.length >= maxAliases) {
      return;
    }

    // Add the new alias
    onChange([...aliases, trimmedValue]);
    setInputValue("");
    inputRef.current?.focus();
  };

  const handleRemoveAlias = (aliasToRemove: string) => {
    if (disabled) return;
    onChange(aliases.filter((alias) => alias !== aliasToRemove));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddAlias();
    } else if (e.key === "Backspace" && !inputValue && aliases.length > 0) {
      // Remove last alias when pressing backspace with empty input
      handleRemoveAlias(aliases[aliases.length - 1]);
    }
  };

  const canAddMore = maxAliases === 0 || aliases.length < maxAliases;

  return (
    <div className={cn("space-y-3", className)}>
      {/* Alias Tags Display */}
      <div className="flex flex-wrap gap-2 min-h-[32px]">
        {aliases.length === 0 && !disabled && (
          <span className="text-sm text-muted-foreground italic">
            {t.noAliases}
          </span>
        )}
        {aliases.map((alias, index) => (
          <Badge
            key={`${alias}-${index}`}
            variant="secondary"
            className={cn(
              "flex items-center gap-1 px-2 py-1 text-sm",
              !disabled && "pr-1 hover:bg-secondary/80"
            )}
          >
            <Tag className="h-3 w-3" />
            <span dir="auto">{alias}</span>
            {!disabled && (
              <button
                type="button"
                onClick={() => handleRemoveAlias(alias)}
                className="mr-1 rounded-full p-0.5 hover:bg-destructive/20 hover:text-destructive transition-colors"
                aria-label={`${t.removeAliasLabel} "${alias}"`}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </Badge>
        ))}
      </div>

      {/* Add Alias Input */}
      {!disabled && canAddMore && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Input
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={disabled}
              dir="auto"
              className="pr-10"
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleAddAlias}
            disabled={disabled || !inputValue.trim()}
          >
            <Plus className="h-4 w-4 ml-1" />
            {t.addAlias}
          </Button>
        </div>
      )}

      {/* Helpful Examples */}
      <div className="text-xs text-muted-foreground space-y-1 bg-muted/50 rounded-md p-3">
        <p className="font-medium flex items-center gap-1">
          <Tag className="h-3 w-3" />
          {t.help.title}
        </p>
        <p>
          {t.help.description}
        </p>
        <p className="mt-2">
          <span className="font-medium">{t.help.examplesTitle}</span>
        </p>
        <ul className="list-disc list-inside mr-4 space-y-0.5">
          <li>{t.help.examples.shortNames}</li>
          <li>{t.help.examples.alternativeSpellings}</li>
          <li>{t.help.examples.branchNumbers}</li>
          <li>{t.help.examples.internalCodes}</li>
        </ul>
      </div>

      {/* Limit indicator */}
      {maxAliases > 0 && (
        <div className="text-xs text-muted-foreground text-right">
          {t.limitIndicator
            .replace("{current}", String(aliases.length))
            .replace("{max}", String(maxAliases))}
        </div>
      )}
    </div>
  );
}
