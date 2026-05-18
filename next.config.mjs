/** @type {import('next').NextConfig} */

const nextConfig = {
  typedRoutes: false,
  cacheComponents: true,
  reactCompiler: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '9mb',
    },
  },
  devIndicators: false,
  webpack: (config) => {
    config.resolve.alias.canvas = false
    return config
  },
  turbopack: {},
  serverExternalPackages: ['knex', 'puppeteer-core', '@sparticuz/chromium'],
  poweredByHeader: false,
  outputFileTracingIncludes: {
    
    '**/*': [
      './migrations/**/*',
      './public/fonts/**/*',
      './node_modules/@sparticuz/chromium/bin/**/*',
    ],
  },
}

export default nextConfig
