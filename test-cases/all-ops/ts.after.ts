export function formatPrice(value: number): string {
  return value.toFixed(2);
}

export function applyTax(value: number): number {
  return value * 1.13;
}

export function parsePrice(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

export function roundHalfUp(value: number): number {
  return Math.round(value * 100) / 100;
}
