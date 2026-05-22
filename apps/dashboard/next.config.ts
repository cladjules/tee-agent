import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Suppress warnings for packages that use Node.js built-ins in the client bundle
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        crypto: false,
        os: false,
        path: false,
        net: false,
        tls: false,
      };
    }
    return config;
  },
};

export default nextConfig;
