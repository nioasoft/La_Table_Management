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
};

export default nextConfig;
