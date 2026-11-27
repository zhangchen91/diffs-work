// a small ledger
export const RATE = 0.05;

export function fee(a: number): number {
  return a * RATE;
}

export function legacy(): number {
  return 0;
}

export function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
