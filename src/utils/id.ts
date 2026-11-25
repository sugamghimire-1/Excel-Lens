let counter = 0;

/** Short, collision-resistant identifier. */
export function uid(prefix: string): string {
  counter = (counter + 1) % 46_656;
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}_${time}${counter.toString(36).padStart(3, '0')}${rand}`;
}
