/**
 * Next.js configuration for MediaHub web.
 *
 * Static export is enabled so the output is pure HTML/CSS/JS that can be served
 * by the Go backend (or any static host) without a Node.js runtime.
 *
 * @type {import('next').NextConfig}
 */
const path = require('path');
const webpack = require('webpack');

const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    config.output.environment = {
      ...config.output.environment,
      dynamicImport: true,
    };

    if (isServer) {
      // During server prerender (next build static generation), replace client-only
      // crypto modules that depend on browser WebCrypto/DOM with safe mocks.
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /[\\/]src[\\/]lib[\\/]crypto[\\/](Bencrypt|Bencode|Opsec)\.js$/,
          path.resolve(__dirname, 'src/lib/crypto/mock.js')
        )
      );
    } else {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: false,
        fs: false,
        path: false,
      };

      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean)),
        ({ request }, callback) => {
          if (request && (request.startsWith('https://') || request.startsWith('http://'))) {
            return callback(null, 'promise import(' + JSON.stringify(request) + ')');
          }
          if (
            request &&
            (request === 'js-sha3' ||
              request === 'argon2' ||
              request.startsWith('@noble/post-quantum'))
          ) {
            return callback(null, 'var undefined');
          }
          callback();
        },
      ];
    }

    config.module.rules.push({
      test: /[\\/]src[\\/]lib[\\/]crypto[\\/]Bencrypt\.js$/,
      use: [path.resolve(__dirname, 'scripts/bencrypt-loader.js')],
    });

    config.module.rules.push({
      test: /[\\/]src[\\/]lib[\\/]crypto[\\/]Opsec\.js$/,
      use: [path.resolve(__dirname, 'scripts/opsec-loader.js')],
    });

    return config;
  },
};

module.exports = nextConfig;