"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LayoutDashboard,
  Receipt,
  Database,
  FileText,
  Settings,
  ChevronDown,
  ChevronUp,
  Store,
  Building2,
  Users,
  Mail,
  LogOut,
  User,
  FileBarChart,
  CheckCircle,
  Calculator,
  PanelLeftClose,
  PanelLeft,
  FileUp,
  Percent,
  Files,
  Scale,
  FileSpreadsheet,
  Menu,
  Archive,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { he } from "@/lib/translations/he";
import { useSidebar } from "./sidebar-context";
import type { UserRole } from "@/db/schema";
import { useState } from "react";

interface NavChild {
  label: string;
  href: string;
  icon: React.ReactNode;
  badge?: number | null;
}

interface NavItem {
  label: string;
  href?: string;
  icon: React.ReactNode;
  children?: NavChild[];
}

interface SidebarProps {
  userRole?: UserRole | null;
  userName?: string;
  userEmail?: string;
}

export function Sidebar({ userRole, userName, userEmail }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { isCollapsed, toggle } = useSidebar();
  const [expandedSections, setExpandedSections] = useState<string[]>([
    "dataManagement",
    "settings",
    "reports",
  ]);

  const isSuperUserOrAdmin = userRole === "super_user" || userRole === "admin";

  // Fetch count of supplier files needing review for badge
  const { data: reviewData } = useQuery({
    queryKey: ["supplier-files", "review", "count"],
    queryFn: async () => {
      const response = await fetch("/api/supplier-files/review/count");
      if (!response.ok) return { count: 0 };
      return response.json();
    },
    enabled: isSuperUserOrAdmin,
    staleTime: 30000,
  });

  const filesNeedingReviewCount = reviewData?.count || 0;

  const handleSignOut = async () => {
    await authClient.signOut();
    router.push("/sign-in");
  };

  const toggleSection = (section: string) => {
    setExpandedSections((prev) =>
      prev.includes(section)
        ? prev.filter((s) => s !== section)
        : [...prev, section]
    );
  };

  const isActive = (href: string) => {
    if (href === "/dashboard") {
      return pathname === "/dashboard";
    }
    return pathname.startsWith(href);
  };

  const isChildActive = (children: { href: string }[]) => {
    return children.some((child) => pathname.startsWith(child.href));
  };

  const navItems: NavItem[] = [
    {
      label: he.sidebar.navigation.dashboard,
      href: "/dashboard",
      icon: <LayoutDashboard className="h-5 w-5" />,
    },
    ...(isSuperUserOrAdmin
      ? [
          {
            label: he.sidebar.navigation.dataManagement,
            icon: <Database className="h-5 w-5" />,
            children: [
              {
                label: he.sidebar.subNavigation.suppliers,
                href: "/admin/suppliers",
                icon: <Store className="h-4 w-4" />,
              },
              {
                label: he.sidebar.subNavigation.franchisees,
                href: "/admin/franchisees",
                icon: <Building2 className="h-4 w-4" />,
              },
              {
                label: he.sidebar.subNavigation.bkmvdata,
                href: "/admin/bkmvdata",
                icon: <FileUp className="h-4 w-4" />,
              },
              {
                label: he.sidebar.subNavigation.supplierFiles,
                href: "/admin/supplier-files/completeness",
                icon: <FileUp className="h-4 w-4" />,
                badge:
                  filesNeedingReviewCount > 0 ? filesNeedingReviewCount : null,
              },
            ],
          },
          {
            label: he.sidebar.navigation.reports,
            icon: <FileText className="h-5 w-5" />,
            children: [
              {
                label: he.sidebar.subNavigation.supplierReconciliation,
                href: "/admin/reconciliation-v2",
                icon: <Scale className="h-4 w-4" />,
              },
              {
                label: he.sidebar.subNavigation.invoiceReport,
                href: "/admin/reports/invoice",
                icon: <Receipt className="h-4 w-4" />,
              },
              {
                label: he.sidebar.subNavigation.filesReport,
                href: "/admin/reports/files",
                icon: <Files className="h-4 w-4" />,
              },
              {
                label: he.sidebar.subNavigation.supplierFilesReport,
                href: "/admin/reports/supplier-files",
                icon: <FileUp className="h-4 w-4" />,
              },
              {
                label: he.sidebar.subNavigation.hashavshevetExport,
                href: "/admin/reports/hashavshevet",
                icon: <FileSpreadsheet className="h-4 w-4" />,
              },
            ],
          },
          {
            label: he.sidebar.navigation.settings,
            icon: <Settings className="h-5 w-5" />,
            children: [
              {
                label: he.sidebar.subNavigation.users,
                href: "/admin/users",
                icon: <Users className="h-4 w-4" />,
              },
              {
                label: he.sidebar.subNavigation.communications,
                href: "/admin/communications",
                icon: <Mail className="h-4 w-4" />,
              },
              {
                label: he.sidebar.subNavigation.vatRates,
                href: "/admin/vat-rates",
                icon: <Percent className="h-4 w-4" />,
              },
            ],
          },
          {
            label: he.sidebar.navigation.archive,
            icon: <Archive className="h-5 w-5" />,
            children: [
              {
                label: he.sidebar.subNavigation.settlementSimple,
                href: "/admin/settlement-simple",
                icon: <Scale className="h-4 w-4" />,
              },
              {
                label: he.sidebar.subNavigation.settlements,
                href: "/admin/settlements",
                icon: <CheckCircle className="h-4 w-4" />,
              },
              {
                label: he.sidebar.subNavigation.reconciliation,
                href: "/admin/reconciliation",
                icon: <FileBarChart className="h-4 w-4" />,
              },
              {
                label: he.sidebar.subNavigation.commissions,
                href: "/admin/commissions",
                icon: <Calculator className="h-4 w-4" />,
              },
              {
                label: he.sidebar.subNavigation.reportsHub,
                href: "/admin/reports",
                icon: <FileText className="h-4 w-4" />,
              },
              {
                label: he.sidebar.subNavigation.commissionsReport,
                href: "/admin/reports/commissions",
                icon: <FileBarChart className="h-4 w-4" />,
              },
              {
                label: he.sidebar.subNavigation.varianceReport,
                href: "/admin/reports/variance",
                icon: <FileBarChart className="h-4 w-4" />,
              },
              {
                label: he.sidebar.subNavigation.unauthorizedReport,
                href: "/admin/reports/unauthorized",
                icon: <FileBarChart className="h-4 w-4" />,
              },
              {
                label: he.sidebar.subNavigation.depositsReport,
                href: "/admin/reports/deposits",
                icon: <FileBarChart className="h-4 w-4" />,
              },
            ],
          },
        ]
      : []),
  ];

  // Render a nav item with tooltip when collapsed
  const renderNavItem = (item: NavItem, index: number) => {
    const hasChildren = item.children && item.children.length > 0;

    if (item.href) {
      // Simple nav item (no children)
      const content = (
        <Link
          href={item.href}
          className={cn(
            "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all duration-200",
            isActive(item.href)
              ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
              : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
          )}
        >
          {/* Active indicator */}
          {isActive(item.href) && (
            <span className="absolute inset-y-1 start-0 w-[3px] rounded-full bg-sidebar-primary" />
          )}
          <span className={cn(isCollapsed && "mx-auto")}>{item.icon}</span>
          {!isCollapsed && (
            <span className="transition-opacity duration-200">{item.label}</span>
          )}
        </Link>
      );

      if (isCollapsed) {
        return (
          <li key={index}>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>{content}</TooltipTrigger>
              <TooltipContent side="left" className="font-medium">
                {item.label}
              </TooltipContent>
            </Tooltip>
          </li>
        );
      }

      return <li key={index}>{content}</li>;
    }

    // Nav item with children
    if (hasChildren) {
      if (isCollapsed) {
        // Collapsed: show dropdown menu
        return (
          <li key={index}>
            <DropdownMenu>
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      className={cn(
                        "group relative flex w-full items-center justify-center rounded-lg px-3 py-2.5 transition-all duration-200",
                        isChildActive(item.children!)
                          ? "bg-sidebar-accent/50 text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                      )}
                    >
                      {/* Active indicator */}
                      {isChildActive(item.children!) && (
                        <span className="absolute inset-y-1 start-0 w-[3px] rounded-full bg-sidebar-primary/50" />
                      )}
                      {item.icon}
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="left" className="font-medium">
                  {item.label}
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent
                side="left"
                align="start"
                className="min-w-48"
              >
                {item.children!.map((child, childIndex) => (
                  <DropdownMenuItem key={childIndex} asChild>
                    <Link
                      href={child.href}
                      className={cn(
                        "flex items-center gap-2 cursor-pointer",
                        isActive(child.href) && "bg-accent"
                      )}
                    >
                      {child.icon}
                      <span className="flex-1">{child.label}</span>
                      {child.badge !== null && child.badge !== undefined && (
                        <Badge
                          variant="destructive"
                          className="h-5 min-w-5 px-1.5 text-xs font-medium"
                        >
                          {child.badge}
                        </Badge>
                      )}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        );
      }

      // Expanded: show collapsible section
      return (
        <li key={index}>
          <button
            onClick={() => toggleSection(item.label)}
            aria-expanded={expandedSections.includes(item.label)}
            className={cn(
              "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 transition-all duration-200",
              isChildActive(item.children!)
                ? "bg-sidebar-accent/50 text-sidebar-accent-foreground"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
            )}
          >
            {/* Active indicator */}
            {isChildActive(item.children!) && (
              <span className="absolute inset-y-1 start-0 w-[3px] rounded-full bg-sidebar-primary/50" />
            )}
            {item.icon}
            <span className="flex-1 text-start">{item.label}</span>
            {expandedSections.includes(item.label) ? (
              <ChevronUp className="h-4 w-4 transition-transform duration-200" />
            ) : (
              <ChevronDown className="h-4 w-4 transition-transform duration-200" />
            )}
          </button>
          <div
            className={cn(
              "overflow-hidden transition-all duration-200",
              expandedSections.includes(item.label)
                ? "max-h-96 opacity-100"
                : "max-h-0 opacity-0"
            )}
          >
            <ul className="mt-1 ms-4 space-y-0.5 border-s border-sidebar-border/50 ps-2">
              {item.children!.map((child, childIndex) => (
                <li key={childIndex}>
                  <Link
                    href={child.href}
                    className={cn(
                      "group relative flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all duration-200",
                      isActive(child.href)
                        ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                    )}
                  >
                    {/* Active indicator */}
                    {isActive(child.href) && (
                      <span className="absolute inset-y-1 start-0 w-[2px] rounded-full bg-sidebar-primary" />
                    )}
                    {child.icon}
                    <span className="flex-1">{child.label}</span>
                    {child.badge !== null && child.badge !== undefined && (
                      <Badge
                        variant="destructive"
                        className="h-5 min-w-5 px-1.5 text-xs font-medium"
                      >
                        {child.badge}
                      </Badge>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </li>
      );
    }

    return null;
  };

  return (
    <aside
      className={cn(
        "fixed inset-y-0 start-0 z-50 flex flex-col bg-sidebar text-sidebar-foreground border-e border-sidebar-border shadow-sm",
        "transition-[width] duration-250 ease-[cubic-bezier(0.4,0,0.2,1)]",
        isCollapsed ? "w-16" : "w-64"
      )}
    >
      {/* Header */}
      <div className="flex h-16 items-center justify-between px-3 border-b border-sidebar-border">
        <div
          className={cn(
            "overflow-hidden transition-all duration-200",
            isCollapsed ? "w-0 opacity-0" : "w-auto opacity-100"
          )}
        >
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="text-xl font-bold text-sidebar-primary whitespace-nowrap">
              {he.sidebar.brandName}
            </span>
            <span className="text-xs text-sidebar-foreground/60 whitespace-nowrap">
              {he.sidebar.brandSubtitle}
            </span>
          </Link>
        </div>
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggle}
              aria-label={isCollapsed ? he.sidebar.expand : he.sidebar.collapse}
              aria-expanded={!isCollapsed}
              className={cn(
                "h-8 w-8 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors",
                isCollapsed && "mx-auto"
              )}
            >
              {isCollapsed ? (
                <PanelLeft className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            <span>{isCollapsed ? he.sidebar.expand : he.sidebar.collapse}</span>
            <kbd className="ms-2 text-xs text-muted-foreground">⌘B</kbd>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-1">{navItems.map(renderNavItem)}</ul>
      </nav>

      {/* User section */}
      <div className="border-t border-sidebar-border p-2">
        {!isCollapsed ? (
          <div className="space-y-2">
            <div className="flex items-center gap-3 px-3 py-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-accent">
                <User className="h-4 w-4 text-sidebar-accent-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{userName}</p>
                <p
                  className="text-xs text-sidebar-foreground/60 truncate"
                  dir="ltr"
                >
                  {userEmail}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              onClick={handleSignOut}
              className="w-full justify-start gap-2 text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <LogOut className="h-4 w-4" />
              {he.sidebar.user.signOut}
            </Button>
          </div>
        ) : (
          <div className="space-y-1">
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-full h-10 text-sidebar-foreground/80 hover:bg-sidebar-accent"
                >
                  <User className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">
                {userName || he.sidebar.user.profile}
              </TooltipContent>
            </Tooltip>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleSignOut}
                  className="w-full h-10 text-sidebar-foreground/80 hover:bg-sidebar-accent"
                >
                  <LogOut className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">{he.sidebar.user.signOut}</TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>
    </aside>
  );
}

// Mobile sidebar toggle button
export function MobileSidebarToggle({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      className="lg:hidden fixed top-4 start-4 z-40 bg-background/80 backdrop-blur-xs border shadow-sm"
    >
      <Menu className="h-5 w-5" />
    </Button>
  );
}
