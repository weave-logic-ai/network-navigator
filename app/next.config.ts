import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const __project_root = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: __project_root,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "media.licdn.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
