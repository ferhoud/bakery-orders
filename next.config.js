/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: { unoptimized: true }, // évite /_next/image => lambda
};
module.exports = nextConfig;
