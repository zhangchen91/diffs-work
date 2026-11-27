export function early(): string { return "a"; }

export function moved(x: number): number {
  const doubled = x * 2;
  return doubled + 1;
}

export function late(): string { return "z"; }
