import { useCallback, useEffect, useMemo, useState } from 'react';

export default function usePagination(items, pageSize) {
  const [page, setPage] = useState(1);

  const total = items ? items.length : 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Back to page 1 whenever the data set changes (new search / filter).
  useEffect(() => {
    setPage(1);
  }, [items]);

  const goTo = useCallback(
    (p) => setPage(Math.min(Math.max(1, p), totalPages)),
    [totalPages]
  );

  const pageItems = useMemo(() => {
    if (!items) return items;
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return { page, totalPages, pageItems, goTo, from, to, total };
}
