// a small ledger
export const RATE = 0.07;

export function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

export function fee(a: number): number {
  return a * RATE;
}

export function count(xs: number[]): number {
  return xs.length;
}
