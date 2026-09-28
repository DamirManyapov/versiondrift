/** "5:29.8.1-1~debian.12~bookworm" → "29.8.1", "1:7.0.31-1+debian12" → "7.0.31", "16.4-1.pgdg120+1" → "16.4". */
export function upstreamVersion(packageVersion: string): string | null {
  const noEpoch = packageVersion.replace(/^\d+:/, '');
  return /^\d+(?:\.\d+)*/.exec(noEpoch)?.[0] ?? null;
}
