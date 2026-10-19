declare module 'hyphen/en-us' {
  /** Inserts soft hyphens (U+00AD) at the hyphenation points of every word. */
  export function hyphenateSync(text: string, options?: { hyphenChar?: string; minWordLength?: number }): string;
  const patterns: { hyphenateSync: typeof hyphenateSync };
  export default patterns;
}
