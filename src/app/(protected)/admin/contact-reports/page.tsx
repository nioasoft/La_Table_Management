"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ExcelExportButton } from "@/components/reports/report-export-button";
import { Store, Building2, UserRound, MapPin } from "lucide-react";

export default function ContactReportsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">ייצוא דוחות אנשי קשר</h1>
        <p className="text-muted-foreground mt-1">
          ייצוא רשימות אנשי קשר של זכיינים, ספקים ואנשי מטה לקובץ אקסל
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Store className="h-5 w-5 text-primary" />
              <CardTitle>דוח זכיינים</CardTitle>
            </div>
            <CardDescription>
              רשימת כל הזכיינים עם פרטי בעלים: שם, טלפון, אימייל ואחוז בעלות
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ExcelExportButton
              endpoint="/api/reports/contacts/franchisees/export"
              reportType="franchisee-contacts"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              <CardTitle>דוח ספקים</CardTitle>
            </div>
            <CardDescription>
              רשימת כל הספקים עם פרטי אנשי קשר ומותגים משויכים
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ExcelExportButton
              endpoint="/api/reports/contacts/suppliers/export"
              reportType="supplier-contacts"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <UserRound className="h-5 w-5 text-primary" />
              <CardTitle>דוח אנשי מטה</CardTitle>
            </div>
            <CardDescription>
              רשימת כל אנשי המטה עם פרטי קשר ותפקידים
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ExcelExportButton
              endpoint="/api/reports/contacts/staff/export"
              reportType="staff-contacts"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" />
              <CardTitle>רשימת סניפים</CardTitle>
            </div>
            <CardDescription>
              רשימת כל הסניפים עם ח.פ., כתובת ופרטי איש קשר
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ExcelExportButton
              endpoint="/api/reports/contacts/franchisees/branches/export"
              reportType="franchisee-branches"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
