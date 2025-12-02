import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
  transpilePackages: ['@final-score/api-football', '@final-score/ic-js', '@final-score/declarations'],
};

export default nextConfig;
