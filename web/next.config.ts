import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a phone on the same Wi-Fi open the dev server by the Mac's address
  // (http://192.168.x.x:3000). Without it Next.js blocks the dev scripts for
  // any host but localhost and the page never hydrates. Development only.
  allowedDevOrigins: ["192.168.*.*"],
};

export default nextConfig;
