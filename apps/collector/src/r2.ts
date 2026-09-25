// Cloudflare R2 through the REST API (no wrangler): PUT/GET objects with the account API token.
export interface R2Bucket {
  put(
    key: string,
    body: string | Uint8Array,
    headers: { contentType: string; cacheControl?: string },
  ): Promise<void>;
  /** undefined when the object does not exist. */
  get(key: string): Promise<Uint8Array | undefined>;
}

export interface R2Options {
  accountId: string;
  token: string;
  bucket: string;
  fetch?: typeof fetch;
  retries?: number;
}

const objectPath = (key: string) => key.split('/').map(encodeURIComponent).join('/');

export function r2Bucket(options: R2Options): R2Bucket {
  const doFetch = options.fetch ?? fetch;
  const base = `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/r2/buckets/${options.bucket}/objects/`;
  const attempt = async (key: string, init: RequestInit): Promise<Response> => {
    for (let i = 0; ; i++) {
      try {
        const response = await doFetch(base + objectPath(key), {
          ...init,
          headers: { authorization: `Bearer ${options.token}`, ...init.headers },
        });
        if ((response.status >= 500 || response.status === 429) && i < (options.retries ?? 3))
          throw new Error(`HTTP ${response.status}`);
        return response;
      } catch (error) {
        if (i >= (options.retries ?? 3)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** i));
      }
    }
  };
  return {
    async put(key, body, headers) {
      const response = await attempt(key, {
        method: 'PUT',
        body,
        headers: {
          'content-type': headers.contentType,
          ...(headers.cacheControl && { 'cache-control': headers.cacheControl }),
        },
      });
      if (!response.ok)
        throw new Error(
          `R2 PUT ${options.bucket}/${key}: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`,
        );
    },
    async get(key) {
      const response = await attempt(key, { method: 'GET' });
      if (response.status === 404) return undefined;
      if (!response.ok) throw new Error(`R2 GET ${options.bucket}/${key}: HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}
