/**
 * Webpack loader for Opsec.js
 *
 * In Opsec.js, line 2-3 does:
 *   const BencryptURL = './Bencrypt.js';
 *   const { Random, HashMaster, ... } = await import(BencryptURL);
 *
 * Because `BencryptURL` is a variable, Webpack treats dynamic import as an expression
 * and fails to bind it to the bundled `./Bencrypt.js` module, emitting a runtime
 * "Cannot find module './Bencrypt.js'".
 *
 * This loader rewrites `await import(BencryptURL)` to `await import('./Bencrypt.js')`
 * at bundle-time so Webpack can statically resolve and bundle the dependency,
 * while preserving the original unmodified source file.
 */
module.exports = function (source) {
  return source.replace(
    /await\s+import\(\s*BencryptURL\s*\)/g,
    "await import('./Bencrypt.js')"
  );
};
