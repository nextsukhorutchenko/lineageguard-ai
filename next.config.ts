import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
    },
  },
  poweredByHeader: false,
};

export default nextConfig;
