const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export type HeaderValue = string | string[] | undefined;

function firstHeaderValue(value: HeaderValue): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function isLocalOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return LOCAL_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export function isLocalBrowserRequestOriginAllowed(
  origin: HeaderValue,
  referer: HeaderValue,
): boolean {
  const originValue = firstHeaderValue(origin);
  if (originValue) return isLocalOrigin(originValue);

  const refererValue = firstHeaderValue(referer);
  if (refererValue) return isLocalOrigin(refererValue);

  return true;
}
