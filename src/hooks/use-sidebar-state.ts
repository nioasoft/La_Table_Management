"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "sidebar-collapsed";

interface UseSidebarStateReturn {
  isCollapsed: boolean;
  toggle: () => void;
  setCollapsed: (collapsed: boolean) => void;
}

/**
 * Hook for managing sidebar collapsed state with localStorage persistence
 * and keyboard shortcut support (Cmd/Ctrl + B)
 */
export function useSidebarState(
  defaultCollapsed = false
): UseSidebarStateReturn {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [isHydrated, setIsHydrated] = useState(false);

  // Hydrate from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      setIsCollapsed(stored === "true");
    }
    setIsHydrated(true);
  }, []);

  // Persist to localStorage when state changes (after hydration)
  useEffect(() => {
    if (isHydrated) {
      localStorage.setItem(STORAGE_KEY, String(isCollapsed));
    }
  }, [isCollapsed, isHydrated]);

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
