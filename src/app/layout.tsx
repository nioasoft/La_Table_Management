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
  title: "La Table - מערכת לניהול זכיינויות",
  description: "מערכת לניהול זכיינויות ומסעדות עבור קבוצת La Table",
  icons: {
    icon: "/favicon.ico",
  },
  openGraph: {
    title: "La Table - מערכת לניהול זכיינויות",
    description: "מערכת לניהול זכיינויות ומסעדות עבור קבוצת La Table",
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
    <html lang="he" dir="rtl" suppressHydrationWarning className={assistant.variable}>
      <body className="font-sans antialiased">
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
