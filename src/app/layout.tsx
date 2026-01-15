import type { Metadata } from "next";
import { Assistant } from "next/font/google";
import "@/styles/globals.css";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";

// Use Assistant font which has excellent Hebrew support
const assistant = Assistant({
  subsets: ["latin", "hebrew"],
  variable: "--font-assistant",
  display: "swap",
});

export const metadata: Metadata = {
  title: "La Table Management - מערכת ניהול עמלות",
  description: "מערכת לניהול עמלות, התאמות ותקשורת עם ספקים וזכיינים עבור קבוצת המסעדות La Table",
  icons: {
    icon: "/favicon.ico",
  },
  openGraph: {
    title: "La Table Management - מערכת ניהול עמלות",
    description: "מערכת לניהול עמלות, התאמות ותקשורת עם ספקים וזכיינים עבור קבוצת המסעדות La Table",
    locale: "he_IL",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="he" dir="rtl" suppressHydrationWarning>
      <body className={`${assistant.variable} font-sans antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster position="top-center" richColors dir="rtl" />
        </ThemeProvider>
      </body>
    </html>
  );
}
