export function formatCurrency(amount: number): string {
  return `₱${amount.toLocaleString('en-PH', {
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
