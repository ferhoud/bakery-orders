/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      { source: '/becus', destination: '/suppliers/becus', permanent: true },
      { source: '/cdp', destination: '/suppliers/cdp', permanent: true },
      { source: '/moulins', destination: '/suppliers/moulins', permanent: true },
    ];
  },
};
module.exports = nextConfig;
