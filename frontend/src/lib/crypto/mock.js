// Server-side prerender mock for USAG crypto modules.
// These functions are client-only and run in the browser after mount.

export function SHA3256() { return new Uint8Array(32); }
export function Random() { return new Uint8Array(32); }
export class Masker {
  XOR(b) { return b; }
}
export class HashMaster {}
export class SymMaster {
  async DeBin() { return new Uint8Array(0); }
  async EnBin() { return new Uint8Array(0); }
}
export function Encode64() { return ''; }
export function Decode64() { return new Uint8Array(0); }
export function NormPW() { return new Uint8Array(0); }
export function EncodeCfg() { return new Uint8Array(0); }
export function DecodeCfg() { return {}; }
export const Opsec = {};
export default {};
