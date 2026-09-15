/**
 * Webpack loader for Bencrypt.js
 *
 * In Bencrypt.js, browser-runtime dependencies are loaded via dynamic import:
 *   const webSha3 = (await import('https://esm.sh/js-sha3@0.9.3')).default;
 *   const webArgon2 = (await import('https://cdn.jsdelivr.net/npm/argon2-browser@1.18.0/dist/argon2-bundled.min.js/+esm')).default;
 *   const webNoble = await import('https://esm.sh/@noble/curves@1.4.0/ed448');
 *   const { ml_kem1024 } = await import('https://esm.sh/@noble/post-quantum/ml-kem');
 *   const { ml_dsa87 } = await import('https://esm.sh/@noble/post-quantum/ml-dsa');
 *
 * By default, Webpack intercepts dynamic import('https://...') and wraps them in
 * an internal CommonJS/ESM interop helper `__webpack_require__.t(..., 22)`.
 * Because native browser ESM modules lack the synthetic `__esModule` property,
 * Webpack's interop helper wraps the native Module namespace inside another
 * `{ default: mod }` layer. This causes `(await import(...)).default` to evaluate
 * to the Module namespace rather than the actual default export, leaving
 * `webSha3.sha3_256` as `undefined` and throwing:
 *   Cannot read properties of undefined (reading 'create')
 *
 * By adding `/* webpackIgnore: true * /` to dynamic imports of HTTP(S) URLs,
 * Webpack emits pure, native browser `import('https://...')` statements without
 * any runtime wrapping, preserving the original semantics without modifying the
 * source Bencrypt.js file.
 */
module.exports = function (source) {
  return source.replace(
    /import\(\s*(['"]https?:\/\/[^'"]+['"])\s*\)/g,
    'import(/* webpackIgnore: true */ $1)'
  );
};
