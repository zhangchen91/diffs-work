/**
 * Price book — quote lines for a B2B order.
 */
import { round } from "./money";

export interface QuoteLine {
  sku: string;
  units: number;
  unitPrice: number;
}

export const TAX_RATE = 0.06;
export const VOLUME_THRESHOLD = 100;

/** Deprecated: tax now lives in the checkout service. */
export function legacyTax(amount: number): number {
  return round(amount * 0.13);
}

export function lineTotal(line: QuoteLine): number {
  return round(line.units * line.unitPrice);
}

/** A 5% break once an order passes the volume threshold. */
export function volumeDiscount(units: number): number {
  if (units < VOLUME_THRESHOLD) return 0;
  return round(units * 0.05);
}

export function subtotal(lines: QuoteLine[]): number {
  return round(lines.reduce((sum, line) => sum + lineTotal(line), 0));
}

export function quoteTotal(lines: QuoteLine[]): number {
  const units = lines.reduce((n, line) => n + line.units, 0);
  return round(subtotal(lines) - volumeDiscount(units));
}
