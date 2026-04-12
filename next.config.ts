import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable React 19 features
  experimental: {
    // Enable server actions
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },

  // Externalize react-pdf only. pdfjs-dist and tesseract.js must be BUNDLED
  // (not externalized) so they ship with the Vercel serverless function.
  // The parsers use variable-based dynamic imports to bypass Turbopack static
  // analysis at build time.
  serverExternalPackages: ["@react-pdf/renderer"],

  // Image optimization domains (add as needed)
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "**.r2.cloudflarestorage.com",
      },
    ],
  },

  // Security headers
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },

  // Redirects from old report paths to new paths
  async redirects() {
    return [
      {
        source: "/admin/commissions/report",
        destination: "/admin/reports/commissions",
        permanent: true,
      },
      {
        source: "/admin/commissions/variance",
        destination: "/admin/reports/variance",
        permanent: true,
      },
      {
        source: "/admin/commissions/invoice",
        destination: "/admin/reports/invoice",
        permanent: true,
      },
      {
        source: "/admin/commissions/brand",
        destination: "/admin/reports/commissions",
        permanent: true,
      },
      {
        source: "/admin/commissions/supplier",
        destination: "/admin/reports/commissions",
        permanent: true,
      },
      {
        source: "/admin/commissions/franchisee",
        destination: "/admin/reports/commissions",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
