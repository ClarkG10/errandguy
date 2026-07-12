export function formatCurrency(amount: number): string {
  // Defensive coercion: a currency label must NEVER render "[object Object]"
  // or "NaN" if a caller (or a stale cache entry) hands us a non-numeric
  // value. Anything that isn't a finite number falls back to 0.
  const n = typeof amount === 'number' ? amount : Number(amount);
  const safe = Number.isFinite(n) ? n : 0;
  return `₱${safe.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatCurrencyCompact(amount: number): string {
  if (amount >= 1000000) {
    return `₱${(amount / 1000000).toFixed(1)}M`;
  }
  if (amount >= 1000) {
    return `₱${(amount / 1000).toFixed(1)}K`;
  }
  return formatCurrency(amount);
}
