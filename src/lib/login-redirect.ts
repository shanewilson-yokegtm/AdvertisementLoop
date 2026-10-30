/** Sign-in URL that returns to the exact page, query included (the connector consent page needs authorization_id). */
export function loginRedirect(from: URL) {
  const back = from.pathname + from.search;
  const url = new URL('/login', from.origin);
  if (back !== '/') url.searchParams.set('next', back);
  return url;
}
