export interface Money {
  amount: number;
  currency: string;
}

export function add(a: number, b: number): number {
  return a + b;
}

export function format(m: Money): string {
  return `${m.currency} ${m.amount.toFixed(2)}`;
}
