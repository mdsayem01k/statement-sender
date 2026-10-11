// Returns e.g. [1, '…start', 4, 5, 6, '…end', 20]
export function getPageItems(current, total, siblings = 1) {
  const totalSlots = siblings * 2 + 5;
  if (total <= totalSlots) return Array.from({ length: total }, (_, i) => i + 1);

  const left = Math.max(current - siblings, 2);
  const right = Math.min(current + siblings, total - 1);
  const items = [1];

  if (left > 2) items.push('…start');
  for (let p = left; p <= right; p++) items.push(p);
  if (right < total - 1) items.push('…end');

  items.push(total);
  return items;
}
