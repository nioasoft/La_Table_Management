"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
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
  Tag,
  Users,
  Mail,
  Bell,
  LogOut,
  User,
  FileBarChart,
  CheckCircle,
  Calculator,
  ChevronLeft,
  ChevronRight,
  Menu,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { he } from "@/lib/translations/he";
import type { UserRole } from "@/db/schema";

interface NavItem {
  label: string;
  href?: string;
  icon: React.ReactNode;
  children?: { label: string; href: string; icon: React.ReactNode }[];
}

interface SidebarProps {
  userRole?: UserRole | null;
  userName?: string;
  userEmail?: string;
}

export function Sidebar({ userRole, userName, userEmail }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [expandedSections, setExpandedSections] = useState<string[]>([
    "settlementWorkflow",
    "dataManagement",
    "settings",
    "reports",
  ]);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const isSuperUserOrAdmin = userRole === "super_user" || userRole === "admin";

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
            label: he.sidebar.navigation.settlementWorkflow,
            icon: <Receipt className="h-5 w-5" />,
            children: [
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
            ],
          },
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
                label: he.sidebar.subNavigation.brands,
                href: "/admin/brands",
                icon: <Tag className="h-4 w-4" />,
              },
            ],
          },
          {
            label: he.sidebar.navigation.reports,
            icon: <FileText className="h-5 w-5" />,
            children: [
              {
                label: he.sidebar.subNavigation.commissionsReport,
                href: "/admin/commissions/report",
                icon: <FileBarChart className="h-4 w-4" />,
              },
              {
                label: he.sidebar.subNavigation.generalReports,
                href: "/admin/reports",
                icon: <FileText className="h-4 w-4" />,
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
                label: he.sidebar.subNavigation.emailTemplates,
                href: "/admin/email-templates",
                icon: <Mail className="h-4 w-4" />,
              },
              {
                label: he.sidebar.subNavigation.franchiseeReminders,
                href: "/admin/franchisee-reminders",
                icon: <Bell className="h-4 w-4" />,
              },
            ],
          },
        ]
      : []),
  ];

  return (
    <aside
      className={cn(
        "fixed inset-y-0 start-0 z-50 flex flex-col bg-sidebar text-sidebar-foreground border-e border-sidebar-border transition-all duration-300",
        isCollapsed ? "w-16" : "w-64"
      )}
    >
      {/* Header */}
      <div className="flex h-16 items-center justify-between px-4 border-b border-sidebar-border">
        {!isCollapsed && (
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="text-xl font-bold text-sidebar-primary">
              {he.sidebar.brandName}
            </span>
            <span className="text-xs text-sidebar-foreground/60">
              {he.sidebar.brandSubtitle}
            </span>
          </Link>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent"
          title={isCollapsed ? he.sidebar.expand : he.sidebar.collapse}
        >
          {isCollapsed ? (
            <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
          ) : (
            <ChevronRight className="h-4 w-4 rtl:rotate-180" />
          )}
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-1">
          {navItems.map((item, index) => (
            <li key={index}>
              {item.href ? (
                // Simple nav item (no children)
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 transition-colors",
                    isActive(item.href)
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                  title={isCollapsed ? item.label : undefined}
                >
                  {item.icon}
                  {!isCollapsed && <span>{item.label}</span>}
                </Link>
              ) : (
                // Nav item with children
                <>
                  <button
                    onClick={() => toggleSection(item.label)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2 transition-colors",
                      item.children && isChildActive(item.children)
                        ? "bg-sidebar-accent/50 text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    )}
                    title={isCollapsed ? item.label : undefined}
                  >
                    {item.icon}
                    {!isCollapsed && (
                      <>
                        <span className="flex-1 text-start">{item.label}</span>
                        {expandedSections.includes(item.label) ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </>
                    )}
                  </button>
                  {!isCollapsed &&
                    item.children &&
                    expandedSections.includes(item.label) && (
                      <ul className="mt-1 ms-4 space-y-1 border-s border-sidebar-border ps-2">
                        {item.children.map((child, childIndex) => (
                          <li key={childIndex}>
                            <Link
                              href={child.href}
                              className={cn(
                                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                                isActive(child.href)
                                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                              )}
                            >
                              {child.icon}
                              <span>{child.label}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                </>
              )}
            </li>
          ))}
        </ul>
      </nav>

      {/* User section */}
      <div className="border-t border-sidebar-border p-2">
        {!isCollapsed ? (
          <div className="space-y-2">
            <div className="flex items-center gap-3 px-3 py-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-accent">
                <User className="h-4 w-4 text-sidebar-accent-foreground" />
              </div>
              <div className="flex-1 truncate">
                <p className="text-sm font-medium truncate">{userName}</p>
                <p className="text-xs text-sidebar-foreground/60 truncate" dir="ltr">
                  {userEmail}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              onClick={handleSignOut}
              className="w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <LogOut className="h-4 w-4" />
              {he.sidebar.user.signOut}
            </Button>
          </div>
        ) : (
          <div className="space-y-1">
            <Button
              variant="ghost"
              size="icon"
              className="w-full h-10 text-sidebar-foreground hover:bg-sidebar-accent"
              title={userName || he.sidebar.user.profile}
            >
              <User className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleSignOut}
              className="w-full h-10 text-sidebar-foreground hover:bg-sidebar-accent"
              title={he.sidebar.user.signOut}
            >
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        )}
      </div>
    </aside>
  );
}

// Mobile sidebar toggle button
export function MobileSidebarToggle({
  onClick,
}: {
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      className="lg:hidden fixed top-4 start-4 z-40 bg-background/80 backdrop-blur-sm border"
    >
      <Menu className="h-5 w-5" />
    </Button>
  );
}
