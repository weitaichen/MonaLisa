/** FNV-1a 32 of a shader with its whitespace collapsed: the tripwire that ties a shader to its CPU port. */
export function shaderHash(src: string): string {
  let h = 0x811c9dc5;
  for (const ch of src.replace(/\s+/g, ' ').trim()) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
