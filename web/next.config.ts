import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a phone on the same Wi-Fi open the dev server by the Mac's address
  // (http://192.168.x.x:3000). Without it Next.js blocks the dev scripts for
  // any host but localhost and the page never hydrates. Development only.
  allowedDevOrigins: ["192.168.*.*"],

  // Development only: DEV_API_PROXY=https://sectionary-pink.vercel.app sends
  // /api/* to that deployment, so with the NEXT_PUBLIC_*_SRC values set to the
  // /api paths the wall, Sites and Flows show real blocks without a database.
  // Pair it with the dev plan switch (bottom right) to see Free and signed out.
  async rewrites() {
    const target = process.env.NODE_ENV === "development" ? process.env.DEV_API_PROXY?.replace(/\/+$/, "") : undefined;
    return target ? { beforeFiles: [{ source: "/api/:path*", destination: `${target}/api/:path*` }], afterFiles: [], fallback: [] } : [];
  },

  // The "Pages" tab became Flows (SEC-20). A real redirect, so old links and
  // bookmarks move for good rather than bouncing through a meta refresh.
  async redirects() {
    return [{ source: "/pages", destination: "/flows", permanent: true }];
  },

  // Security headers on every response. No other site may frame ours (so the
  // sign-in, two-step and account pages cannot be dressed up as a click-trap),
  // HTTPS only, no MIME sniffing, no full URLs (share slugs, tokens) sent to
  // other sites. Not a script-src policy: Paddle.js and Next's inline scripts
  // would need one tuned and tested first. No form-action either: the billing
  // buttons are forms that redirect to Paddle, which form-action would block.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
