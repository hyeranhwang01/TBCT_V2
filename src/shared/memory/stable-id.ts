// A stable ~106-bit hash, hex (two seeded cyrb53 passes). For stable ids only
// (memory chunk ids), not for security. Pure JS, no BigInt (the TS target is
// ES2017), so it runs in the browser bundle and the server alike --
// runtime-execution-api.ts, which imports the chunk builder, is bundled for
// both.

function cyrb53(value: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

export function stableId(value: string): string {
  return `${cyrb53(value, 1)}${cyrb53(value, 2)}`;
}
