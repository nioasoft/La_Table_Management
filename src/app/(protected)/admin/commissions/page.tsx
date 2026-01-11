"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  LogOut,
  ChevronRight,
  Truck,
  Building2,
  Store,
  FileSpreadsheet,
  Receipt,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";

const commissionSections = [
  {
    title: "לפי ספק",
    description: "צפייה וניהול עמלות מקובצות לפי ספק",
    href: "/admin/commissions/supplier",
    icon: Truck,
  },
  {
    title: "לפי מותג",
    description: "צפייה וניהול עמלות מקובצות לפי מותג",
    href: "/admin/commissions/brand",
    icon: Building2,
  },
  {
    title: "לפי זכיין",
    description: "צפייה וניהול עמלות מקובצות לפי זכיין",
    href: "/admin/commissions/franchisee",
    icon: Store,
  },
  {
    title: "דוחות עמלות",
    description: "יצירת וייצוא דוחות עמלות",
    href: "/admin/commissions/report",
    icon: FileSpreadsheet,
  },
  {
    title: "חשבוניות",
    description: "ניהול חשבוניות עמלות ותשלומים",
    href: "/admin/commissions/invoice",
    icon: Receipt,
  },
  {
    title: "ניתוח סטיות",
    description: "ניתוח סטיות ופערים בעמלות",
    href: "/admin/commissions/variance",
    icon: AlertTriangle,
  },
];

export default function CommissionsPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  const userRole = session
    ? (session.user as { role?: string })?.role
    : undefined;

  useEffect(() => {
    if (!isPending && !session) {
      router.push("/sign-in?redirect=/admin/commissions");
      return;
    }

    // Check if user has permission
    if (
      !isPending &&
      session?.user &&
      userRole !== "super_user" &&
      userRole !== "admin"
    ) {
      router.push("/dashboard");
      return;
    }
  }, [session, isPending, router, userRole]);

  const handleSignOut = async () => {
    await authClient.signOut();
    router.push("/sign-in");
  };

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm">
              <ChevronRight className="h-4 w-4 ml-1" />
              לוח בקרה
            </Button>
          </Link>
          <h1 className="text-3xl font-bold">ניהול עמלות</h1>
        </div>
        <Button variant="outline" onClick={handleSignOut}>
          <LogOut className="ml-2 h-4 w-4" />
          התנתק
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {commissionSections.map((section) => (
          <Link key={section.href} href={section.href}>
            <Card className="h-full cursor-pointer hover:border-primary hover:shadow-md transition-all">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <section.icon className="h-6 w-6 text-primary" />
                  </div>
                  <CardTitle className="text-lg">{section.title}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-sm">
                  {section.description}
                </CardDescription>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
