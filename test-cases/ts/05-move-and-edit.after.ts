export function early(): string { return "a"; }

export function late(): string { return "z"; }

export function moved(x: number): number {
  const doubled = x * 3;
  return doubled + 1;
}
