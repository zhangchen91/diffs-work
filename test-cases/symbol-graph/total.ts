import { add, format, type Money } from "./money";

export function totalOf(items: Money[]): Money {
  const amount = items.reduce((sum, m) => add(sum, m.amount), 0);
  return { amount, currency: "CNY" };
}

export function label(items: Money[]): string {
  return format(totalOf(items));
}
