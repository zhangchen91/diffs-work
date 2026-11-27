/**
 * Price book — quote lines for a B2B order.
 */
import { round } from "./money";

export interface QuoteLine {
  sku: string;
  units: number;
  unitPrice: number;
}

// 改：税率调整
export const TAX_RATE = 0.08;
export const VOLUME_THRESHOLD = 100;

// 删：legacyTax 整个函数移除

export function lineTotal(line: QuoteLine): number {
  return round(line.units * line.unitPrice);
}

/** A tiered break once an order passes the volume threshold. */
export function volumeDiscount(units: number): number {
  if (units < VOLUME_THRESHOLD) return 0;
  if (units >= 1000) return round(units * 0.08);
  return round(units * 0.05);
}

// 增：新的税计算函数
export function lineTax(line: QuoteLine): number {
  return round(lineTotal(line) * TAX_RATE);
}

export function subtotal(lines: QuoteLine[]): number {
  return round(lines.reduce((sum, line) => sum + lineTotal(line) + lineTax(line), 0));
}

export function quoteTotal(lines: QuoteLine[]): number {
  const units = lines.reduce((n, line) => n + line.units, 0);
  return round(subtotal(lines) - volumeDiscount(units));
}
