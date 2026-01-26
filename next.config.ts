import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable React 19 features
  experimental: {
    // Enable server actions
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },

  // Externalize react-pdf for server-side rendering
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
