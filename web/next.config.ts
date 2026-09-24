import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a phone on the same Wi-Fi open the dev server by the Mac's address
  // (http://192.168.x.x:3000). Without it Next.js blocks the dev scripts for
  // any host but localhost and the page never hydrates. Development only.
  allowedDevOrigins: ["192.168.*.*"],

  // The "Pages" tab became Flows (SEC-20). A real redirect, so old links and
  // bookmarks move for good rather than bouncing through a meta refresh.
  async redirects() {
    return [{ source: "/pages", destination: "/flows", permanent: true }];
  },
};

export default nextConfig;
