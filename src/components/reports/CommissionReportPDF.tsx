import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";
import { formatCurrency } from "@/lib/translations";

// Register Rubik font for Hebrew support
// Using Google Fonts CDN for Rubik
Font.register({
  family: "Rubik",
  fonts: [
    {
      src: "https://fonts.gstatic.com/s/rubik/v28/iJWZBXyIfDnIV5PNhY1KTN7Z-Yh-B4iFWkU1.ttf",
      fontWeight: 400,
    },
    {
      src: "https://fonts.gstatic.com/s/rubik/v28/iJWZBXyIfDnIV5PNhY1KTN7Z-Yh-WYiFWkU1.ttf",
      fontWeight: 700,
    },
  ],
});

// Hyphenation callback for Hebrew
Font.registerHyphenationCallback((word) => [word]);

// Types for report data
export interface CommissionSummaryByBrand {
  brandId: string;
  brandNameHe: string;
  brandNameEn: string | null;
  commissionCount: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommissionAmount: number;
  avgCommissionRate: number;
}

export interface CommissionSummaryByPeriod {
  periodStartDate: string;
  periodEndDate: string;
  commissionCount: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommissionAmount: number;
}

export interface CommissionSummaryBySupplier {
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  commissionCount: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommissionAmount: number;
  avgCommissionRate: number;
}

export interface CommissionWithDetails {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  franchiseeId: string;
  franchiseeName: string;
  franchiseeCode: string;
  brandId: string;
  brandNameHe: string;
  brandNameEn: string | null;
  periodStartDate: string;
  periodEndDate: string;
  status: string;
  grossAmount: string;
  netAmount: string | null;
  commissionRate: string;
  commissionAmount: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  notes: string | null;
  createdAt: Date;
}

export interface CommissionReportData {
  summary: {
    totalCommissions: number;
    totalGrossAmount: number;
    totalNetAmount: number;
    totalCommissionAmount: number;
    avgCommissionRate: number;
    periodRange: {
      startDate: string | null;
      endDate: string | null;
    };
    generatedAt: string;
  };
  byBrand: CommissionSummaryByBrand[];
  byPeriod: CommissionSummaryByPeriod[];
  bySupplier: CommissionSummaryBySupplier[];
  details: CommissionWithDetails[];
}

// RTL styles for Hebrew PDF
const styles = StyleSheet.create({
  page: {
    flexDirection: "column",
    backgroundColor: "#FFFFFF",
    padding: 30,
    fontFamily: "Rubik",
    direction: "rtl",
  },
  header: {
    marginBottom: 20,
    borderBottom: "2px solid #1e40af",
    paddingBottom: 15,
  },
  title: {
    fontSize: 24,
    fontWeight: 700,
    color: "#1e40af",
    textAlign: "right",
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 12,
    color: "#6b7280",
    textAlign: "right",
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: "#1f2937",
    marginBottom: 10,
    textAlign: "right",
    backgroundColor: "#f3f4f6",
    padding: 8,
    borderRadius: 4,
  },
  summaryGrid: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  summaryCard: {
    width: "48%",
    backgroundColor: "#f8fafc",
    padding: 15,
    marginBottom: 10,
    borderRadius: 6,
    borderLeft: "4px solid #3b82f6",
  },
  summaryLabel: {
    fontSize: 10,
    color: "#6b7280",
    textAlign: "right",
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: 700,
    color: "#1f2937",
    textAlign: "right",
  },
  table: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    marginTop: 10,
  },
  tableRow: {
    flexDirection: "row-reverse",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    minHeight: 30,
    alignItems: "center",
  },
  tableHeaderRow: {
    backgroundColor: "#1e40af",
    borderBottomWidth: 0,
  },
  tableHeaderCell: {
    fontSize: 9,
    fontWeight: 700,
    color: "#FFFFFF",
    textAlign: "right",
    padding: 8,
  },
  tableCell: {
    fontSize: 9,
    color: "#374151",
    textAlign: "right",
    padding: 8,
  },
  // Column widths for brand table
  colBrand: { width: "30%" },
  colCount: { width: "14%" },
  colGross: { width: "14%" },
  colNet: { width: "14%" },
  colCommission: { width: "14%" },
  colRate: { width: "14%" },
  // Column widths for period table
  colStartDate: { width: "20%" },
  colEndDate: { width: "20%" },
  colPeriodCount: { width: "15%" },
  colPeriodGross: { width: "15%" },
  colPeriodNet: { width: "15%" },
  colPeriodCommission: { width: "15%" },
  // Column widths for supplier table
  colSupplierName: { width: "25%" },
  colSupplierCode: { width: "10%" },
  colSupplierCount: { width: "10%" },
  colSupplierGross: { width: "15%" },
  colSupplierNet: { width: "15%" },
  colSupplierCommission: { width: "15%" },
  colSupplierRate: { width: "10%" },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 30,
    right: 30,
    textAlign: "center",
    fontSize: 8,
    color: "#9ca3af",
    borderTop: "1px solid #e5e7eb",
    paddingTop: 10,
  },
  pageNumber: {
    position: "absolute",
    bottom: 20,
    left: 30,
    fontSize: 10,
    color: "#6b7280",
  },
  statusBadge: {
    fontSize: 8,
    padding: "2 6",
    borderRadius: 4,
    textAlign: "center",
  },
  statusPending: {
    backgroundColor: "#fef3c7",
    color: "#92400e",
  },
  statusCalculated: {
    backgroundColor: "#e0e7ff",
    color: "#3730a3",
  },
  statusApproved: {
    backgroundColor: "#d1fae5",
    color: "#065f46",
  },
  statusPaid: {
    backgroundColor: "#dbeafe",
    color: "#1e40af",
  },
  statusCancelled: {
    backgroundColor: "#fee2e2",
    color: "#991b1b",
  },
});

// Format percentage
const formatPercent = (rate: number): string => {
  return `${rate.toFixed(2)}%`;
};

// Format date for display in Hebrew locale
const formatDate = (dateStr: string): string => {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("he-IL");
};

// Map status to Hebrew
const getStatusLabel = (status: string): string => {
  const statusMap: Record<string, string> = {
    pending: "ממתין",
    calculated: "חושב",
    approved: "מאושר",
    paid: "שולם",
    cancelled: "בוטל",
  };
  return statusMap[status] || status;
};

// Summary Page Component
const SummaryPage: React.FC<{ report: CommissionReportData }> = ({
  report,
}) => (
  <Page size="A4" style={styles.page}>
    <View style={styles.header}>
      <Text style={styles.title}>דוח עמלות רשת</Text>
      <Text style={styles.subtitle}>
        תאריך הפקה: {formatDate(report.summary.generatedAt)}
      </Text>
    </View>

    <View style={styles.section}>
      <Text style={styles.sectionTitle}>סיכום כללי</Text>
      <View style={styles.summaryGrid}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>סה״כ עמלות</Text>
          <Text style={styles.summaryValue}>
            {formatCurrency(report.summary.totalCommissionAmount)}
          </Text>
          <Text style={styles.summaryLabel}>
            {report.summary.totalCommissions} רשומות
          </Text>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>סה״כ כולל מע״מ</Text>
          <Text style={styles.summaryValue}>
            {formatCurrency(report.summary.totalGrossAmount)}
          </Text>
          <Text style={styles.summaryLabel}>
            לפני מע״מ: {formatCurrency(report.summary.totalNetAmount)}
          </Text>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>שיעור עמלה ממוצע</Text>
          <Text style={styles.summaryValue}>
            {formatPercent(report.summary.avgCommissionRate)}
          </Text>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>טווח תקופה</Text>
          <Text style={styles.summaryValue}>
            {report.summary.periodRange.startDate &&
            report.summary.periodRange.endDate
              ? `${formatDate(report.summary.periodRange.startDate)} - ${formatDate(report.summary.periodRange.endDate)}`
              : "לא זמין"}
          </Text>
        </View>
      </View>
    </View>

    {/* By Brand Section */}
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>סיכום לפי מותג</Text>
      <View style={styles.table}>
        <View style={[styles.tableRow, styles.tableHeaderRow]}>
          <View style={styles.colBrand}>
            <Text style={styles.tableHeaderCell}>מותג</Text>
          </View>
          <View style={styles.colCount}>
            <Text style={styles.tableHeaderCell}>מספר עמלות</Text>
          </View>
          <View style={styles.colGross}>
            <Text style={styles.tableHeaderCell}>כולל מע״מ</Text>
          </View>
          <View style={styles.colNet}>
            <Text style={styles.tableHeaderCell}>לפני מע״מ</Text>
          </View>
          <View style={styles.colCommission}>
            <Text style={styles.tableHeaderCell}>עמלה</Text>
          </View>
          <View style={styles.colRate}>
            <Text style={styles.tableHeaderCell}>שיעור</Text>
          </View>
        </View>
        {report.byBrand.map((brand, index) => (
          <View
            key={brand.brandId}
            style={[
              styles.tableRow,
              { backgroundColor: index % 2 === 0 ? "#f9fafb" : "#FFFFFF" },
            ]}
          >
            <View style={styles.colBrand}>
              <Text style={styles.tableCell}>{brand.brandNameHe}</Text>
            </View>
            <View style={styles.colCount}>
              <Text style={styles.tableCell}>{brand.commissionCount}</Text>
            </View>
            <View style={styles.colGross}>
              <Text style={styles.tableCell}>
                {formatCurrency(brand.totalGrossAmount)}
              </Text>
            </View>
            <View style={styles.colNet}>
              <Text style={styles.tableCell}>
                {formatCurrency(brand.totalNetAmount)}
              </Text>
            </View>
            <View style={styles.colCommission}>
              <Text style={styles.tableCell}>
                {formatCurrency(brand.totalCommissionAmount)}
              </Text>
            </View>
            <View style={styles.colRate}>
              <Text style={styles.tableCell}>
                {formatPercent(brand.avgCommissionRate)}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>

    <Text style={styles.footer}>
      La Table Management - דוח עמלות
    </Text>
    <Text
      style={styles.pageNumber}
      render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
      fixed
    />
  </Page>
);

// By Period Page Component
const ByPeriodPage: React.FC<{ report: CommissionReportData }> = ({
  report,
}) => (
  <Page size="A4" style={styles.page}>
    <View style={styles.header}>
      <Text style={styles.title}>דוח עמלות - לפי תקופה</Text>
    </View>

    <View style={styles.section}>
      <Text style={styles.sectionTitle}>סיכום לפי תקופה</Text>
      <View style={styles.table}>
        <View style={[styles.tableRow, styles.tableHeaderRow]}>
          <View style={styles.colStartDate}>
            <Text style={styles.tableHeaderCell}>תאריך התחלה</Text>
          </View>
          <View style={styles.colEndDate}>
            <Text style={styles.tableHeaderCell}>תאריך סיום</Text>
          </View>
          <View style={styles.colPeriodCount}>
            <Text style={styles.tableHeaderCell}>מספר עמלות</Text>
          </View>
          <View style={styles.colPeriodGross}>
            <Text style={styles.tableHeaderCell}>כולל מע״מ</Text>
          </View>
          <View style={styles.colPeriodNet}>
            <Text style={styles.tableHeaderCell}>לפני מע״מ</Text>
          </View>
          <View style={styles.colPeriodCommission}>
            <Text style={styles.tableHeaderCell}>עמלה</Text>
          </View>
        </View>
        {report.byPeriod.map((period, index) => (
          <View
            key={index}
            style={[
              styles.tableRow,
              { backgroundColor: index % 2 === 0 ? "#f9fafb" : "#FFFFFF" },
            ]}
          >
            <View style={styles.colStartDate}>
              <Text style={styles.tableCell}>
                {formatDate(period.periodStartDate)}
              </Text>
            </View>
            <View style={styles.colEndDate}>
              <Text style={styles.tableCell}>
                {formatDate(period.periodEndDate)}
              </Text>
            </View>
            <View style={styles.colPeriodCount}>
              <Text style={styles.tableCell}>{period.commissionCount}</Text>
            </View>
            <View style={styles.colPeriodGross}>
              <Text style={styles.tableCell}>
                {formatCurrency(period.totalGrossAmount)}
              </Text>
            </View>
            <View style={styles.colPeriodNet}>
              <Text style={styles.tableCell}>
                {formatCurrency(period.totalNetAmount)}
              </Text>
            </View>
            <View style={styles.colPeriodCommission}>
              <Text style={styles.tableCell}>
                {formatCurrency(period.totalCommissionAmount)}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>

    <Text style={styles.footer}>
      La Table Management - דוח עמלות
    </Text>
    <Text
      style={styles.pageNumber}
      render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
      fixed
    />
  </Page>
);

// By Supplier Page Component
const BySupplierPage: React.FC<{ report: CommissionReportData }> = ({
  report,
}) => (
  <Page size="A4" style={styles.page}>
    <View style={styles.header}>
      <Text style={styles.title}>דוח עמלות - לפי ספק</Text>
    </View>

    <View style={styles.section}>
      <Text style={styles.sectionTitle}>סיכום לפי ספק</Text>
      <View style={styles.table}>
        <View style={[styles.tableRow, styles.tableHeaderRow]}>
          <View style={styles.colSupplierName}>
            <Text style={styles.tableHeaderCell}>שם ספק</Text>
          </View>
          <View style={styles.colSupplierCode}>
            <Text style={styles.tableHeaderCell}>קוד</Text>
          </View>
          <View style={styles.colSupplierCount}>
            <Text style={styles.tableHeaderCell}>עמלות</Text>
          </View>
          <View style={styles.colSupplierGross}>
            <Text style={styles.tableHeaderCell}>כולל מע״מ</Text>
          </View>
          <View style={styles.colSupplierNet}>
            <Text style={styles.tableHeaderCell}>לפני מע״מ</Text>
          </View>
          <View style={styles.colSupplierCommission}>
            <Text style={styles.tableHeaderCell}>עמלה</Text>
          </View>
          <View style={styles.colSupplierRate}>
            <Text style={styles.tableHeaderCell}>שיעור</Text>
          </View>
        </View>
        {report.bySupplier.map((supplier, index) => (
          <View
            key={supplier.supplierId}
            style={[
              styles.tableRow,
              { backgroundColor: index % 2 === 0 ? "#f9fafb" : "#FFFFFF" },
            ]}
          >
            <View style={styles.colSupplierName}>
              <Text style={styles.tableCell}>{supplier.supplierName}</Text>
            </View>
            <View style={styles.colSupplierCode}>
              <Text style={styles.tableCell}>{supplier.supplierCode}</Text>
            </View>
            <View style={styles.colSupplierCount}>
              <Text style={styles.tableCell}>{supplier.commissionCount}</Text>
            </View>
            <View style={styles.colSupplierGross}>
              <Text style={styles.tableCell}>
                {formatCurrency(supplier.totalGrossAmount)}
              </Text>
            </View>
            <View style={styles.colSupplierNet}>
              <Text style={styles.tableCell}>
                {formatCurrency(supplier.totalNetAmount)}
              </Text>
            </View>
            <View style={styles.colSupplierCommission}>
              <Text style={styles.tableCell}>
                {formatCurrency(supplier.totalCommissionAmount)}
              </Text>
            </View>
            <View style={styles.colSupplierRate}>
              <Text style={styles.tableCell}>
                {formatPercent(supplier.avgCommissionRate)}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>

    <Text style={styles.footer}>
      La Table Management - דוח עמלות
    </Text>
    <Text
      style={styles.pageNumber}
      render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
      fixed
    />
  </Page>
);

// Details pages - split details into multiple pages (max 25 per page)
const DetailsPages: React.FC<{ details: CommissionWithDetails[] }> = ({
  details,
}) => {
  const ITEMS_PER_PAGE = 25;
  const pages = [];
  for (let i = 0; i < details.length; i += ITEMS_PER_PAGE) {
    pages.push(details.slice(i, i + ITEMS_PER_PAGE));
  }

  return (
    <>
      {pages.map((pageDetails, pageIndex) => (
        <Page key={pageIndex} size="A4" orientation="landscape" style={styles.page}>
          <View style={styles.header}>
            <Text style={styles.title}>דוח עמלות - פירוט מלא</Text>
            <Text style={styles.subtitle}>
              עמוד {pageIndex + 1} מתוך {pages.length} (רשומות {pageIndex * ITEMS_PER_PAGE + 1} - {Math.min((pageIndex + 1) * ITEMS_PER_PAGE, details.length)} מתוך {details.length})
            </Text>
          </View>

          <View style={styles.table}>
            <View style={[styles.tableRow, styles.tableHeaderRow]}>
              <View style={{ width: "15%" }}>
                <Text style={styles.tableHeaderCell}>ספק</Text>
              </View>
              <View style={{ width: "12%" }}>
                <Text style={styles.tableHeaderCell}>זכיין</Text>
              </View>
              <View style={{ width: "10%" }}>
                <Text style={styles.tableHeaderCell}>מותג</Text>
              </View>
              <View style={{ width: "15%" }}>
                <Text style={styles.tableHeaderCell}>תקופה</Text>
              </View>
              <View style={{ width: "12%" }}>
                <Text style={styles.tableHeaderCell}>כולל מע״מ</Text>
              </View>
              <View style={{ width: "12%" }}>
                <Text style={styles.tableHeaderCell}>עמלה</Text>
              </View>
              <View style={{ width: "8%" }}>
                <Text style={styles.tableHeaderCell}>שיעור</Text>
              </View>
              <View style={{ width: "8%" }}>
                <Text style={styles.tableHeaderCell}>סטטוס</Text>
              </View>
              <View style={{ width: "8%" }}>
                <Text style={styles.tableHeaderCell}>חשבונית</Text>
              </View>
            </View>
            {pageDetails.map((commission, index) => (
              <View
                key={commission.id}
                style={[
                  styles.tableRow,
                  { backgroundColor: index % 2 === 0 ? "#f9fafb" : "#FFFFFF" },
                ]}
              >
                <View style={{ width: "15%" }}>
                  <Text style={styles.tableCell}>{commission.supplierName}</Text>
                </View>
                <View style={{ width: "12%" }}>
                  <Text style={styles.tableCell}>{commission.franchiseeName}</Text>
                </View>
                <View style={{ width: "10%" }}>
                  <Text style={styles.tableCell}>{commission.brandNameHe}</Text>
                </View>
                <View style={{ width: "15%" }}>
                  <Text style={styles.tableCell}>
                    {formatDate(commission.periodStartDate)} - {formatDate(commission.periodEndDate)}
                  </Text>
                </View>
                <View style={{ width: "12%" }}>
                  <Text style={styles.tableCell}>
                    {formatCurrency(Number(commission.grossAmount))}
                  </Text>
                </View>
                <View style={{ width: "12%" }}>
                  <Text style={styles.tableCell}>
                    {formatCurrency(Number(commission.commissionAmount))}
                  </Text>
                </View>
                <View style={{ width: "8%" }}>
                  <Text style={styles.tableCell}>
                    {formatPercent(Number(commission.commissionRate))}
                  </Text>
                </View>
                <View style={{ width: "8%" }}>
                  <Text style={styles.tableCell}>
                    {getStatusLabel(commission.status)}
                  </Text>
                </View>
                <View style={{ width: "8%" }}>
                  <Text style={styles.tableCell}>
                    {commission.invoiceNumber || "-"}
                  </Text>
                </View>
              </View>
            ))}
          </View>

          <Text style={styles.footer}>
            La Table Management - דוח עמלות
          </Text>
          <Text
            style={styles.pageNumber}
            render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
            fixed
          />
        </Page>
      ))}
    </>
  );
};

// Main PDF Document
export const CommissionReportPDF: React.FC<{ report: CommissionReportData }> = ({
  report,
}) => (
  <Document>
    <SummaryPage report={report} />
    {report.byPeriod.length > 0 && <ByPeriodPage report={report} />}
    {report.bySupplier.length > 0 && <BySupplierPage report={report} />}
    {report.details.length > 0 && <DetailsPages details={report.details} />}
  </Document>
);

export default CommissionReportPDF;
