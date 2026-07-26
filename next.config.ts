import type { NextConfig } from "next";
import { PUBLIC_BROWSER_HEADERS } from "./src/http/response-headers.js";

const nextConfig: NextConfig = {
  experimental: {
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
    },
  },
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: [...PUBLIC_BROWSER_HEADERS] }];
  },
};

export default nextConfig;
