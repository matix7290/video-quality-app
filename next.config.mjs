/** @type {import('next').NextConfig} */

import nextI18NextConfig from "./next-i18next.config.js";

const nextConfig = {
  reactStrictMode: true,
  i18n: {
    ...nextI18NextConfig.i18n,
  },
};

export default nextConfig;