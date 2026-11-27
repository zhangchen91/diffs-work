export function total(items: number[]): number {
  return items.reduce((a, b) => a + b, 0);
}

export function average(items: number[]): number {
  if (items.length === 0) return 0;
  return total(items) / items.length;
}
