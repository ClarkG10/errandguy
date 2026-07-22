/** Reproduces Laravel's LengthAwarePaginator JSON envelope (data/links/meta). */
export function paginate<T>(
  data: T[],
  total: number,
  page: number,
  perPage: number,
  path: string,
): Record<string, unknown> {
  const lastPage = Math.max(1, Math.ceil(total / perPage));
  const from = total === 0 ? null : (page - 1) * perPage + 1;
  const to = total === 0 ? null : Math.min(page * perPage, total);
  const url = (p: number | null): string | null => (p === null ? null : `${path}?page=${p}`);

  const links: { url: string | null; label: string; active: boolean }[] = [];
  links.push({ url: url(page > 1 ? page - 1 : null), label: '&laquo; Previous', active: false });
  for (let p = 1; p <= lastPage; p++) links.push({ url: url(p), label: String(p), active: p === page });
  links.push({ url: url(page < lastPage ? page + 1 : null), label: 'Next &raquo;', active: false });

  return {
    data,
    links: {
      first: url(1),
      last: url(lastPage),
      prev: url(page > 1 ? page - 1 : null),
      next: url(page < lastPage ? page + 1 : null),
    },
    meta: {
      current_page: page,
      from,
      last_page: lastPage,
      links,
      path,
      per_page: perPage,
      to,
      total,
    },
  };
}

/** Parse ?page / ?per_page with sane defaults. */
export function pageParams(query: Record<string, unknown>, defaultPerPage = 20): { page: number; perPage: number } {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10) || 1);
  const perPage = Math.max(1, parseInt(String(query.per_page ?? String(defaultPerPage)), 10) || defaultPerPage);
  return { page, perPage };
}
