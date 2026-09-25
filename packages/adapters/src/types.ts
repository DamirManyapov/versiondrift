import type { Fetcher } from './http/fetcher.ts';

export interface ReleaseNotes {
  format: 'markdown' | 'html' | 'text';
  body: string;
}

/** A release as a source reports it, before normalization, filtering and classification (collector). */
export interface RawRelease {
  /** Version text as found: tag name, or the part of a title matched by versionRegex. */
  version: string;
  /** ISO 8601. */
  date?: string;
  /** Link to the release notes. */
  url?: string;
  title?: string;
  notes?: ReleaseNotes;
  /** The source itself marks it as a pre-release (e.g. GitHub's flag). */
  prerelease?: boolean;
}

/** A release branch from a lifecycle source (endoflife.date "release cycle"). */
export interface RawBranch {
  /** Branch/cycle id as the source names it, e.g. "12.1" or "12". */
  name: string;
  codename?: string;
  /** YYYY-MM-DD */
  releaseDate?: string;
  eol: boolean;
  /** YYYY-MM-DD, past or future. */
  eolDate?: string;
  lts: boolean;
  latest?: string;
  latestDate?: string;
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
}

export interface AdapterContext {
  fetcher: Fetcher;
  log: Logger;
  /**
   * Versions (as reported by this source) that are already in the previous feed. Paging adapters stop once a page
   * contains one of them, so a daily run costs one request per source.
   */
  knownVersions: ReadonlySet<string>;
  /** On a first run, releases older than this are not needed (retention window). */
  since?: Date;
  /** Reads a file from the repository (manual sources). */
  readRepoFile?(path: string): Promise<string>;
}

/** Thrown by adapters for problems with the source itself (layout changed, nothing matched, …). */
export class SourceError extends Error {
  override name = 'SourceError';
}
