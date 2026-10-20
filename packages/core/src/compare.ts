/**
 * Locale-independent string ordering for everything that reaches a committed
 * artifact (R-88, R-119a, R-131).
 *
 * `String.prototype.localeCompare` orders by the host's default locale and ICU
 * data, so two machines can sort the same keys differently and produce a
 * spurious `git diff` on an unchanged catalog. These comparators depend only on
 * UTF-16 code units, so the order is identical everywhere.
 */

/** Compare by code unit: `'B' < 'a'`, no locale. Returns -1, 0 or 1. */
export function compareCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Natural order, locale-independent: runs of digits compare by numeric value
 * (`R-2` < `R-10`), everything else by code unit. Equal numeric values with
 * different digit strings (`01` vs `1`) fall back to code-unit order so the
 * comparator is a total order.
 */
export function compareNatural(a: string, b: string): number {
  const chunks = (s: string) => s.match(/\d+|\D+/g) ?? [];
  const ca = chunks(a);
  const cb = chunks(b);
  for (let i = 0; i < Math.min(ca.length, cb.length); i++) {
    const x = ca[i];
    const y = cb[i];
    const bothDigits = /^\d/.test(x) && /^\d/.test(y);
    if (bothDigits) {
      const nx = BigInt(x);
      const ny = BigInt(y);
      if (nx !== ny) return nx < ny ? -1 : 1;
    } else if (x !== y) {
      return compareCodePoint(x, y);
    }
  }
  return Math.sign(ca.length - cb.length) || compareCodePoint(a, b);
}
