/** 12.34 -> "12.3", 80 -> "80" */
export function mm(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/** Areas to the nearest whole mm², or one decimal when small. */
export function mm2(value: number): string {
  return value < 10 ? String(Math.round(value * 10) / 10) : String(Math.round(value));
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Joins "a", "b" and "c" as "a, b and c". */
export function list(items: string[]): string {
  if (items.length < 2) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
