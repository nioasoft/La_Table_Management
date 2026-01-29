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

// ============================================================================
// TYPES
// ============================================================================

export interface BrandGroup {
  brandId: string;
  brandNameHe: string;
  brandNameEn: string | null;
  brandCode: string;
  summary: {
    commissionCount: number;
    totalGrossAmount: number;
    totalNetAmount: number;
    totalCommissionAmount: number;
    avgCommissionRate: number;
  };
}

export interface InvoiceData {
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  periodStartDate: string;
  periodEndDate: string;
  byBrand: BrandGroup[];
  totals: {
    totalBrands: number;
    totalCommissions: number;
    totalGrossAmount: number;
    totalNetAmount: number;
    totalCommissionAmount: number;
  };
  generatedAt: string;
}

// ============================================================================
// STYLES
// ============================================================================

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
    marginBottom: 3,
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
  supplierInfo: {
    backgroundColor: "#f8fafc",
    padding: 15,
    marginBottom: 20,
    borderRadius: 6,
    borderLeft: "4px solid #3b82f6",
  },
  supplierName: {
    fontSize: 18,
    fontWeight: 700,
    color: "#1f2937",
    textAlign: "right",
    marginBottom: 4,
  },
  supplierDetails: {
    fontSize: 10,
    color: "#6b7280",
    textAlign: "right",
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
  tableCellBold: {
    fontSize: 10,
    fontWeight: 700,
    color: "#1f2937",
    textAlign: "right",
    padding: 8,
  },
  // Column widths for brand invoice table
  colBrandCode: { width: "12%" },
  colBrandName: { width: "20%" },
  colCommissionCount: { width: "13%" },
  colGrossAmount: { width: "15%" },
  colNetAmount: { width: "15%" },
  colAvgRate: { width: "10%" },
  colCommissionAmount: { width: "15%" },
  // Totals row
  totalsRow: {
    flexDirection: "row-reverse",
    backgroundColor: "#f3f4f6",
    borderTopWidth: 2,
    borderTopColor: "#1e40af",
    padding: 12,
    marginTop: 10,
    borderRadius: 4,
  },
  totalsLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: "#1f2937",
    textAlign: "right",
    flex: 1,
  },
  totalsValue: {
    fontSize: 12,
    fontWeight: 700,
    color: "#1e40af",
    textAlign: "left",
    marginLeft: 20,
  },
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
  note: {
    backgroundColor: "#fef3c7",
    padding: 12,
    borderRadius: 4,
    borderLeft: "4px solid #f59e0b",
    marginTop: 15,
  },
  noteText: {
    fontSize: 9,
    color: "#78350f",
    textAlign: "right",
    lineHeight: 1.5,
  },
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const formatPercent = (rate: number): string => {
  return `${rate.toFixed(2)}%`;
};

const formatDate = (dateStr: string): string => {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("he-IL");
};

// ============================================================================
// COMPONENTS
// ============================================================================

const InvoiceHeaderPage: React.FC<{ invoice: InvoiceData }> = ({ invoice }) => (
  <Page size="A4" style={styles.page}>
    <View style={styles.header}>
      <Text style={styles.title}>חשבונית עמלות</Text>
      <Text style={styles.subtitle}>
        תאריך הפקה: {formatDate(invoice.generatedAt)}
      </Text>
    </View>

    {/* Supplier Information */}
    <View style={styles.supplierInfo}>
      <Text style={styles.supplierName}>{invoice.supplierName}</Text>
      <Text style={styles.supplierDetails}>
        קוד ספק: {invoice.supplierCode}
      </Text>
      <Text style={styles.supplierDetails}>
        תקופת התחשבנות: {formatDate(invoice.periodStartDate)} -{" "}
        {formatDate(invoice.periodEndDate)}
      </Text>
    </View>

    {/* Summary Section */}
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>סיכום כללי</Text>
      <View style={styles.summaryGrid}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>מספר מותגים</Text>
          <Text style={styles.summaryValue}>{invoice.totals.totalBrands}</Text>
          <Text style={styles.summaryLabel}>חשבוניות נפרדות</Text>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>מספר עמלות</Text>
          <Text style={styles.summaryValue}>
            {invoice.totals.totalCommissions}
          </Text>
          <Text style={styles.summaryLabel}>רשומות עמלה בסה״כ</Text>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>סכום כולל מע״מ</Text>
          <Text style={styles.summaryValue}>
            {formatCurrency(invoice.totals.totalGrossAmount)}
          </Text>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>סכום לפני מע״מ</Text>
          <Text style={styles.summaryValue}>
            {formatCurrency(invoice.totals.totalNetAmount)}
          </Text>
          <Text style={styles.summaryLabel}>לפני מע״מ</Text>
        </View>
      </View>

      {/* Total Amount Highlight */}
      <View style={[styles.supplierInfo, { borderLeftColor: "#16a34a" }]}>
        <Text style={styles.summaryLabel}>סה״כ לתשלום</Text>
        <Text style={[styles.summaryValue, { fontSize: 24, color: "#16a34a" }]}>
          {formatCurrency(invoice.totals.totalCommissionAmount)}
        </Text>
      </View>
    </View>

    {/* Note */}
    <View style={styles.note}>
      <Text style={styles.noteText}>
        הערה: חשבונית זו מפרטת עמלות לפי מותג. כל מותג יקבל חשבונית נפרדת עם הסכום
        המתאים מהחברה המנהלת.
      </Text>
    </View>

    <Text style={styles.footer}>La Table Management - חשבונית עמלות</Text>
    <Text
      style={styles.pageNumber}
      render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
      fixed
    />
  </Page>
);

const BrandDetailsPage: React.FC<{ invoice: InvoiceData }> = ({ invoice }) => (
  <Page size="A4" style={styles.page}>
    <View style={styles.header}>
      <Text style={styles.title}>פירוט לפי מותג</Text>
      <Text style={styles.subtitle}>{invoice.supplierName}</Text>
    </View>

    <View style={styles.section}>
      <Text style={styles.sectionTitle}>חלוקת עמלות לפי מותג</Text>

      {/* Table */}
      <View style={styles.table}>
        {/* Header Row */}
        <View style={[styles.tableRow, styles.tableHeaderRow]}>
          <View style={styles.colBrandCode}>
            <Text style={styles.tableHeaderCell}>קוד מותג</Text>
          </View>
          <View style={styles.colBrandName}>
            <Text style={styles.tableHeaderCell}>שם מותג</Text>
          </View>
          <View style={styles.colCommissionCount}>
            <Text style={styles.tableHeaderCell}>מספר עמלות</Text>
          </View>
          <View style={styles.colGrossAmount}>
            <Text style={styles.tableHeaderCell}>סכום כולל מע״מ</Text>
          </View>
          <View style={styles.colNetAmount}>
            <Text style={styles.tableHeaderCell}>סכום לפני מע״מ</Text>
          </View>
          <View style={styles.colAvgRate}>
            <Text style={styles.tableHeaderCell}>שיעור ממוצע</Text>
          </View>
          <View style={styles.colCommissionAmount}>
            <Text style={styles.tableHeaderCell}>סכום עמלה</Text>
          </View>
        </View>

        {/* Data Rows */}
        {invoice.byBrand.map((brand, index) => (
          <View
            key={brand.brandId}
            style={[
              styles.tableRow,
              { backgroundColor: index % 2 === 0 ? "#f9fafb" : "#FFFFFF" },
            ]}
          >
            <View style={styles.colBrandCode}>
              <Text style={styles.tableCell}>{brand.brandCode}</Text>
            </View>
            <View style={styles.colBrandName}>
              <Text style={styles.tableCellBold}>{brand.brandNameHe}</Text>
            </View>
            <View style={styles.colCommissionCount}>
              <Text style={styles.tableCell}>{brand.summary.commissionCount}</Text>
            </View>
            <View style={styles.colGrossAmount}>
              <Text style={styles.tableCell}>
                {formatCurrency(brand.summary.totalGrossAmount)}
              </Text>
            </View>
            <View style={styles.colNetAmount}>
              <Text style={styles.tableCell}>
                {formatCurrency(brand.summary.totalNetAmount)}
              </Text>
            </View>
            <View style={styles.colAvgRate}>
              <Text style={styles.tableCell}>
                {formatPercent(brand.summary.avgCommissionRate)}
              </Text>
            </View>
            <View style={styles.colCommissionAmount}>
              <Text style={styles.tableCellBold}>
                {formatCurrency(brand.summary.totalCommissionAmount)}
              </Text>
            </View>
          </View>
        ))}
      </View>

      {/* Totals */}
      <View style={styles.totalsRow}>
        <Text style={styles.totalsLabel}>
          סה״כ כללי ({invoice.totals.totalBrands} מותגים, {invoice.totals.totalCommissions} עמלות)
        </Text>
        <Text style={styles.totalsValue}>
          {formatCurrency(invoice.totals.totalCommissionAmount)}
        </Text>
      </View>
    </View>

    {/* Additional Info */}
    <View style={styles.note}>
      <Text style={styles.noteText}>
        לכל מותג תופק חשבונית נפרדת על ידי החברה המנהלת המתאימה (פניקון / פדוילי / ונטמי).
      </Text>
    </View>

    <Text style={styles.footer}>La Table Management - חשבונית עמלות</Text>
    <Text
      style={styles.pageNumber}
      render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
      fixed
    />
  </Page>
);

// ============================================================================
// MAIN DOCUMENT
// ============================================================================

export const InvoiceReportPDF: React.FC<{ invoice: InvoiceData }> = ({
  invoice,
}) => (
  <Document>
    <InvoiceHeaderPage invoice={invoice} />
    <BrandDetailsPage invoice={invoice} />
  </Document>
);

export default InvoiceReportPDF;
