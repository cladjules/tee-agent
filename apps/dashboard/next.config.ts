import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Expose non-secret contract addresses to the client bundle.
  // These are public on-chain values — not secrets.
  env: {
    AGENT_REGISTRY_ADDRESS: process.env.AGENT_REGISTRY_ADDRESS ?? "",
    VALIDATION_REGISTRY_ADDRESS: process.env.VALIDATION_REGISTRY_ADDRESS ?? "",
    REPUTATION_REGISTRY_ADDRESS: process.env.REPUTATION_REGISTRY_ADDRESS ?? "",
  },
  // Prevent Next.js from bundling packages that use node: built-ins (e.g. node:crypto).
  // They are required at runtime by Node.js instead.
  serverExternalPackages: ["@tee-agent/agent"],
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

    // Webpack doesn't handle the node: URI scheme — alias to bare names.
    // Server: resolves to native Node.js modules. Client: maps to false (empty stub).
    const nodeBuiltins = [
      "crypto",
      "buffer",
      "stream",
      "util",
      "path",
      "fs",
      "os",
      "net",
      "tls",
    ];
    config.resolve.alias = {
      ...config.resolve.alias,
      ...Object.fromEntries(
        nodeBuiltins.map((m) => [`node:${m}`, isServer ? m : false]),
      ),
      // MetaMask SDK imports React Native AsyncStorage in its browser bundle —
      // stub it out with false (empty module) for web builds.
      "@react-native-async-storage/async-storage": false,
    };

    return config;
  },
};

export default nextConfig;
