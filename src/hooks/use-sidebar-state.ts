"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "sidebar-collapsed";

interface UseSidebarStateReturn {
  isCollapsed: boolean;
  toggle: () => void;
  setCollapsed: (collapsed: boolean) => void;
}

/**
 * Get initial collapsed state from localStorage (client-side only)
 * Returns undefined during SSR to use default value
 */
function getInitialState(defaultCollapsed: boolean): boolean {
  if (typeof window === "undefined") {
    return defaultCollapsed;
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored !== null ? stored === "true" : defaultCollapsed;
}

/**
 * Hook for managing sidebar collapsed state with localStorage persistence
 * and keyboard shortcut support (Cmd/Ctrl + B)
 */
export function useSidebarState(
  defaultCollapsed = false
): UseSidebarStateReturn {
  const [isCollapsed, setIsCollapsed] = useState(() =>
    getInitialState(defaultCollapsed)
  );

  // Persist to localStorage when state changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(isCollapsed));
  }, [isCollapsed]);

  const toggle = useCallback(() => {
    setIsCollapsed((prev) => !prev);
  }, []);

  const setCollapsed = useCallback((collapsed: boolean) => {
    setIsCollapsed(collapsed);
  }, []);

  // Keyboard shortcut: Cmd/Ctrl + B
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        toggle();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggle]);

  return {
    isCollapsed,
    toggle,
    setCollapsed,
  };
}
