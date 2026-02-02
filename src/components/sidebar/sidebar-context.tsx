"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useSidebarState } from "@/hooks/use-sidebar-state";

interface SidebarContextValue {
  isCollapsed: boolean;
  toggle: () => void;
  setCollapsed: (collapsed: boolean) => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

interface SidebarProviderProps {
  children: ReactNode;
  defaultCollapsed?: boolean;
}

/**
 * Provider for sharing sidebar state across the application
 * Wrap your layout with this provider to enable sidebar state sharing
 */
export function SidebarProvider({
  children,
  defaultCollapsed = false,
}: SidebarProviderProps) {
  const sidebarState = useSidebarState(defaultCollapsed);

  return (
    <SidebarContext.Provider value={sidebarState}>
      {children}
    </SidebarContext.Provider>
  );
}

/**
 * Hook to access sidebar state from any component
 * Must be used within a SidebarProvider
 */
export function useSidebar(): SidebarContextValue {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
}
