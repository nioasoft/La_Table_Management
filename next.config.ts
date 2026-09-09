import type { NextConfig } from "next";

/** node_modules packages the OCR fallback needs at runtime — see below. */
const OCR_TRACE_INCLUDES = [
  "pdfjs-dist/legacy/build",
  "tesseract.js",
  "tesseract.js-core",
  "bmp-js",
  "is-url",
  "node-fetch",
  "regenerator-runtime",
  "tr46",
  "wasm-feature-detect",
  "webidl-conversions",
  "whatwg-url",
  "node-readable-to-web-readable-stream",
  "@napi-rs/canvas*",
].map((pkg) => `./node_modules/${pkg}/**/*`);

const nextConfig: NextConfig = {
  // Enable React 19 features
  experimental: {
    // Enable server actions
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },

  // Externalize react-pdf only. pdfjs-dist and tesseract.js are loaded
  // through variable module specifiers (see loadPdfjs / loadTesseract in the
  // parsers) so Turbopack neither bundles them — bundling breaks tesseract's
  // worker_threads + wasm layout — nor, it turns out, traces them. Adding
  // them to serverExternalPackages was tried (d8b9931) and reverted twice
  // (f855e0b, 55e4227): it too leaves them out of the function.
  serverExternalPackages: ["@react-pdf/renderer"],

  // So they are traced by hand. Every route that can reach the PDF parsers
  // ships the OCR stack verbatim from node_modules; without this the OCR
  // fallback dies in production with "Cannot find package 'pdfjs-dist'"
  // while working perfectly in dev (2026-09-09, Castra's Mishloha report —
  // an image-only jsPDF invoice). The list is what @vercel/nft traces from
  // tesseract.js + its node worker script + pdfjs legacy build; the last two
  // are pdfjs's optional Node helpers (canvas is platform-specific, so the
  // glob also catches the linux binary installed on Vercel).
  outputFileTracingIncludes: Object.fromEntries(
    [
      "/api/clients/documents",
      "/api/clients/email-inbound",
      "/api/admin/inbound-review/",
      "/api/admin/replay-inbound",
      "/api/admin/reprocess-wolt-fileb",
    ].map((route) => [route, OCR_TRACE_INCLUDES]),
  ),

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
