// Also runs as an inline script before the map libraries have loaded.
export async function prefetchArchive(url) {
  try {
    const response = await fetch(url, {
      headers: {Range: 'bytes=0-16383'},
      signal: AbortSignal.timeout(10000),
    });
    if (response.status !== 206 || !/^bytes 0-16383\/\d+$/.test(response.headers.get('Content-Range'))) {
      await response.body?.cancel();
      return null;
    }
    const data = await response.arrayBuffer();
    if (data.byteLength !== 16384) return null;
    const etag = response.headers.get('ETag');
    return {
      data,
      etag: etag && !etag.startsWith('W/') ? etag : undefined,
      cacheControl: response.headers.get('Cache-Control') ?? undefined,
      expires: response.headers.get('Expires') ?? undefined,
    };
  } catch {
    return null;
  }
}

export function prefetchedArchiveSource(fallback, prefetch) {
  let prefix;
  return {
    getKey: () => fallback.getKey(),
    async getBytes(offset, length, signal, etag) {
      if (offset === 0) {
        // A later header lookup may be an ETag retry. Read a fresh header then.
        prefix = await prefetch;
        prefetch = undefined;
      }
      if (prefix && offset + length <= prefix.data.byteLength && (!etag || etag === prefix.etag)) {
        signal?.throwIfAborted();
        return {...prefix, data: prefix.data.slice(offset, offset + length)};
      }
      return fallback.getBytes(offset, length, signal, etag);
    },
  };
}
