import { env } from '$env/dynamic/public';

/** Directory that contains v1/ of the feed; the public one unless PUBLIC_FEED_URL says otherwise. */
export const feedBaseUrl = (): string => env.PUBLIC_FEED_URL || 'https://feed.versiondrift.dev/';
