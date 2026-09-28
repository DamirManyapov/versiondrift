// Module = one products/<id>.yaml. Spec: docs/02-module-spec.md.
// `pnpm schema:gen` turns this into schemas/module.schema.json for module authors' editors, so every
// cross-field rule that is enforced in a refinement below is mirrored in `.meta()` as JSON Schema.
import { z } from 'zod';

export const CATEGORIES = [
  'os',
  'virtualization',
  'containers',
  'orchestration',
  'monitoring',
  'logging',
  'database',
  'mail',
  'network',
  'web',
  'security',
  'storage',
  'backup',
  'messaging',
  'collaboration',
  'ci-cd',
  'identity',
  'other',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const VERSION_SCHEMES = ['semver', 'loose', 'calver', 'debian', 'regex'] as const;
export type VersionScheme = (typeof VERSION_SCHEMES)[number];

/** Change-item types a module can give classifier hints for (`other` needs none). */
export const HINT_TYPES = ['security', 'breaking', 'deprecated', 'feature', 'fix'] as const;
export type HintType = (typeof HINT_TYPES)[number];

/** Track id meaning "any track"; cannot be used as a real track id. */
export const LATEST_TRACK = 'latest';

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;

function regexSyntaxError(pattern: string): string | undefined {
  try {
    new RegExp(pattern);
    return undefined;
  } catch (e) {
    return (e as Error).message;
  }
}

/** A JavaScript regular expression written as a plain string (in YAML: single quotes, no slashes). */
const regex = (description: string) =>
  z
    .string()
    .min(1)
    .superRefine((pattern, ctx) => {
      const error = regexSyntaxError(pattern);
      if (error) ctx.addIssue({ code: 'custom', message: error });
    })
    .meta({ format: 'regex', description });

/** YAML turns `id: 12` into a number; tell the author to quote it. */
const trackId = z
  .string({
    error: (issue) =>
      issue.input === undefined ? undefined : 'must be a string: quote numbers in YAML, e.g. id: "12"',
  })
  .min(1);

const httpUrl = z.url({ protocol: /^https?$/ });
const repoSlug = z.string().regex(/^[\w.-]+\/[\w.-]+$/, { error: 'expected "owner/name"' });
const nonEmpty = z.string().min(1);

// ── Sources ─────────────────────────────────────────────────────────────────────────────────────────────

const GithubSource = z.strictObject({
  type: z.literal('github'),
  repo: repoSlug,
  useTags: z.boolean().optional().meta({ description: 'Read git tags instead of GitHub releases.' }),
  notesFrom: z.enum(['release', 'changelogFile']).optional(),
  changelogPath: nonEmpty
    .optional()
    .meta({ description: 'Path of the changelog file for notesFrom: changelogFile.' }),
  versionRegex: regex(
    "Extracts the version from the tag name; tags that don't match are ignored. First non-empty capture group wins.",
  ).optional(),
});

const GitlabSource = z.strictObject({
  type: z.literal('gitlab'),
  host: nonEmpty.optional().meta({ description: 'Default: gitlab.com' }),
  project: nonEmpty,
});

const GiteaSource = z.strictObject({
  type: z.literal('gitea'),
  host: nonEmpty.meta({ description: 'Gitea or Forgejo instance, e.g. codeberg.org or code.forgejo.org' }),
  repo: repoSlug,
  versionRegex: regex(
    "Extracts the version from the tag name; tags that don't match are ignored. First non-empty capture group wins.",
  ).optional(),
});

const RssReleaseSource = z.strictObject({
  type: z.literal('rss'),
  url: httpUrl,
  versionFrom: z.enum(['title', 'link']).optional(),
  versionRegex: regex(
    'Extracts the version from the entry; the first non-empty capture group wins.',
  ).optional(),
});

const HtmlSource = z.strictObject({
  type: z.literal('html'),
  url: httpUrl,
  select: z
    .strictObject({
      item: nonEmpty,
      title: nonEmpty.optional(),
      body: nonEmpty.optional(),
      date: nonEmpty.optional(),
    })
    .meta({ description: 'CSS selectors: one `item` per release, the others relative to it.' }),
  versionRegex: regex(
    'Extracts the version from the item title (a table row: its cells joined by " | ").',
  ).optional(),
  versionFormat: nonEmpty.optional().meta({
    description: 'Builds the version from versionRegex capture groups, e.g. "$1-$2" (version and build).',
  }),
  dateFormat: nonEmpty.optional(),
});

const DockerhubSource = z.strictObject({
  type: z.literal('dockerhub'),
  repo: nonEmpty.meta({ description: 'Image repository, e.g. analogic/poste.io' }),
  tagRegex: regex('Only tags matching this count as releases.').optional(),
  versionRegex: regex(
    'Extracts the version from the tag; the first non-empty capture group wins.',
  ).optional(),
});

const ManualReleasesSource = z.strictObject({
  type: z.literal('manual'),
  file: nonEmpty.meta({ description: 'products/<id>.releases.yaml, maintained by hand.' }),
});

/** For products without public release notes (OS, appliances): the latest release of every endoflife.date cycle. */
const EndoflifeReleasesSource = z.strictObject({
  type: z.literal('endoflife'),
  product: nonEmpty.meta({ description: 'endoflife.date product slug' }),
});

/**
 * A URL whose text names the current version, like an update server's "newest version" file (MikroTik's
 * NEWESTa7.stable holds "7.24.4 1789558341"). Gives one release a day; history accumulates.
 */
const PointerSource = z.strictObject({
  type: z.literal('pointer'),
  url: httpUrl,
  versionRegex: regex('Extracts the version from the text; the first capture group wins.').optional(),
  epoch: z
    .boolean()
    .optional()
    .meta({ description: 'The text has a Unix time after the version: use it as the release date.' }),
});

/** Versions of one package in an APT repository's Packages index (what is actually installable). */
const AptSource = z.strictObject({
  type: z.literal('apt'),
  url: httpUrl.meta({
    description: 'The Packages index, e.g. …/dists/trixie/pve-no-subscription/binary-amd64/Packages',
  }),
  package: nonEmpty.meta({ description: 'Package name, e.g. pve-manager' }),
  versionRegex: regex('Extracts the version (e.g. drops the Debian revision "-1").').optional(),
});

/** A Debian changelog (debian/changelog): notes and dates per version. */
const DebianChangelogSource = z.strictObject({
  type: z.literal('debian-changelog'),
  url: httpUrl,
  versionRegex: regex('Extracts the version from the entry header.').optional(),
});

/** A changelog file in a vendor's own layout: notes per version (one parser per layout). */
const ChangelogFileSource = z.strictObject({
  type: z.literal('changelog'),
  url: httpUrl,
  dialect: z.enum(['zabbix']).meta({
    description: 'The file layout: zabbix = "Changes for X.Y.Z" blocks with New features / Bug fixes.',
  }),
});

/** releasesExtra only: release notes per version from a URL template, fetched for releases being classified. */
const NotesSource = z.strictObject({
  type: z.literal('notes'),
  url: z
    .string()
    .regex(/^(https?:\/\/.*\{(version|major|minor|patch|build)\}|\{url\})/, {
      error:
        "must be an http(s) URL containing {version} (or its numbers {major}, {minor}, {patch}, {build}), or {url} (the release's own link)",
    })
    .meta({
      description:
        'e.g. https://upgrade.mikrotik.com/routeros/{version}/CHANGELOG, …/relnotes/mysql/{major}.{minor}/en/news-{major}-{minor}-{patch}.html, or {url}',
    }),
  format: z.enum(['text', 'markdown', 'html']).optional().meta({ description: 'Default: text' }),
  dialect: z.enum(['debian-announcement', 'microsoft-kb']).optional().meta({
    description:
      "Page layout to turn into notes: debian-announcement = the point release tables; microsoft-kb = a Windows update's KB article.",
  }),
  select: nonEmpty.optional().meta({
    description:
      'CSS selector for the part of an HTML page that holds the notes (#docContent); its opening names the date if the release has none.',
  }),
  perRun: z.int().min(1).max(200).optional().meta({
    description:
      'Notes fetched per run at most (default 200), for sites that throttle; releases still without notes follow in later runs, newest first.',
  }),
  override: z
    .boolean()
    .optional()
    .meta({ description: 'Use these notes even when the release sources already gave some (a summary).' }),
});

const unknownType =
  (expected: readonly string[]) =>
  (issue: { code?: string }): string | undefined =>
    issue.code === 'invalid_union'
      ? `unknown source type; expected one of: ${expected.join(', ')}`
      : undefined;

const RELEASE_SOURCE_TYPES = [
  'github',
  'gitlab',
  'gitea',
  'rss',
  'html',
  'dockerhub',
  'manual',
  'endoflife',
  'pointer',
  'notes',
  'apt',
  'debian-changelog',
  'changelog',
] as const;
export const ReleaseSource = z
  .discriminatedUnion(
    'type',
    [
      GithubSource,
      GitlabSource,
      GiteaSource,
      RssReleaseSource,
      HtmlSource,
      DockerhubSource,
      ManualReleasesSource,
      EndoflifeReleasesSource,
      PointerSource,
      NotesSource,
      AptSource,
      DebianChangelogSource,
      ChangelogFileSource,
    ],
    { error: unknownType(RELEASE_SOURCE_TYPES) },
  )
  .meta({ id: 'releaseSource' });
export type ReleaseSource = z.output<typeof ReleaseSource>;

const OsvSource = z.strictObject({ type: z.literal('osv'), ecosystem: nonEmpty, package: nonEmpty });

const GhsaSource = z
  .strictObject({
    type: z.literal('ghsa'),
    repo: repoSlug
      .optional()
      .meta({ description: 'Repository advisories. Alternative to ecosystem + package.' }),
    ecosystem: nonEmpty.optional(),
    package: nonEmpty.optional(),
  })
  .superRefine((s, ctx) => {
    const byRepo = s.repo !== undefined && s.ecosystem === undefined && s.package === undefined;
    const byPackage = s.repo === undefined && s.ecosystem !== undefined && s.package !== undefined;
    if (!byRepo && !byPackage)
      ctx.addIssue({ code: 'custom', message: 'set either repo, or ecosystem + package' });
  })
  .meta({
    oneOf: [
      { required: ['repo'], not: { anyOf: [{ required: ['ecosystem'] }, { required: ['package'] }] } },
      { required: ['ecosystem', 'package'], not: { required: ['repo'] } },
    ],
  });

const MsrcSource = z.strictObject({
  type: z.literal('msrc'),
  products: z.array(nonEmpty).min(1).meta({
    description: 'Product names as the Security Update Guide writes them, e.g. "Windows Server 2022".',
  }),
  months: z
    .int()
    .min(1)
    .max(24)
    .optional()
    .meta({ description: 'How far back advisories are read (default 6 months).' }),
});

const NvdSource = z.strictObject({
  type: z.literal('nvd'),
  cpe: z
    .string()
    .regex(/^cpe:2\.3:[aho]:/, { error: 'expected a CPE 2.3 name, e.g. cpe:2.3:a:vendor:product' }),
});

const DebianSource = z.strictObject({
  type: z.literal('debian'),
  packages: z.union([z.array(nonEmpty).min(1), z.literal('fromInventory')]).meta({
    description: 'Source packages to track, or fromInventory to use the packages detected per host.',
  }),
});

const RssSecuritySource = z.strictObject({ type: z.literal('rss'), url: httpUrl });

const SECURITY_SOURCE_TYPES = ['osv', 'ghsa', 'nvd', 'msrc', 'debian', 'rss'] as const;
export const SecuritySource = z
  .discriminatedUnion(
    'type',
    [OsvSource, GhsaSource, NvdSource, MsrcSource, DebianSource, RssSecuritySource],
    {
      error: unknownType(SECURITY_SOURCE_TYPES),
    },
  )
  .meta({ id: 'securitySource' });
export type SecuritySource = z.output<typeof SecuritySource>;

const EndoflifeSource = z.strictObject({
  type: z.literal('endoflife'),
  product: nonEmpty.meta({ description: 'endoflife.date product slug' }),
  cycles: z
    .record(z.string(), nonEmpty)
    .optional()
    .meta({
      description:
        'endoflife.date cycle → the version prefix it covers, when versions do not start with the cycle name ' +
        '(Windows Server: { "2022": "20348" }); other cycles are left out.',
    }),
});

const ManualEolSource = z.strictObject({ type: z.literal('manual'), file: nonEmpty });

export const EolSource = z
  .discriminatedUnion('type', [EndoflifeSource, ManualEolSource], {
    error: unknownType(['endoflife', 'manual']),
  })
  .meta({ id: 'eolSource' });
export type EolSource = z.output<typeof EolSource>;

// ── Detection (self-hosted, Sprint 6) ───────────────────────────────────────────────────────────────────

const extract = regex('Extracts the version; the first capture group wins.').optional();

const DETECTORS = {
  http: z.strictObject({
    path: z.string().regex(/^\//, { error: 'must start with /' }),
    defaultPort: z.int().min(1).max(65535).optional(),
    scheme: z.enum(['http', 'https']).optional(),
    jsonPath: nonEmpty.optional(),
    regex: extract,
    header: nonEmpty.optional(),
  }),
  docker: z.strictObject({ image: nonEmpty }),
  command: z.strictObject({ run: nonEmpty, regex: extract }),
  file: z.strictObject({ path: nonEmpty, regex: extract }),
  snmp: z.strictObject({
    oid: z.string().regex(/^\d+(\.\d+)+$/, { error: 'expected a numeric OID' }),
    regex: extract,
  }),
  sql: z.strictObject({
    engine: z.enum(['mysql', 'postgresql']).optional(),
    query: nonEmpty,
    regex: extract,
  }),
};

export const DetectRule = z
  .strictObject(DETECTORS)
  .partial()
  .superRefine((rule, ctx) => {
    const kinds = Object.keys(rule);
    if (kinds.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        message: `each detect item needs exactly one of: ${Object.keys(DETECTORS).join(', ')} (got ${kinds.length})`,
      });
    }
  })
  .meta({ id: 'detectRule', minProperties: 1, maxProperties: 1 });
export type DetectRule = z.output<typeof DetectRule>;

// ── Module ──────────────────────────────────────────────────────────────────────────────────────────────

export const Track = z
  .strictObject({
    id: trackId.meta({ description: 'Short and stable, e.g. "12" or "7.0". Quote numbers.' }),
    match: regex('Versions matching this belong to the track.').optional(),
    current: z
      .strictObject({
        url: httpUrl,
        versionRegex: regex('Extracts the version; the first capture group wins.').optional(),
      })
      .optional()
      .meta({
        description:
          "Instead of match: a URL naming the track's current version (an update channel); the track is that " +
          "version's major.minor branch, re-read on every collection.",
      }),
    label: nonEmpty.optional().meta({ description: 'Shown next to the id, e.g. LTS or bookworm.' }),
    group: nonEmpty.optional().meta({
      description:
        'A product line the track belongs to ("RouterOS 7"): users pick the line, then the track (update channel) within it.',
    }),
    prereleases: z
      .boolean()
      .optional()
      .meta({ description: 'Pre-releases count in this track (a testing channel with release candidates).' }),
  })
  .superRefine((track, ctx) => {
    if ((track.match === undefined) === (track.current === undefined))
      ctx.addIssue({ code: 'custom', message: 'a track needs exactly one of match or current' });
  })
  .meta({ id: 'track' });
export type Track = z.output<typeof Track>;

const HintMap = z
  .strictObject(
    Object.fromEntries(HINT_TYPES.map((t) => [t, z.array(nonEmpty).optional()])) as Record<
      HintType,
      z.ZodOptional<z.ZodArray<z.ZodString>>
    >,
  )
  .meta({ id: 'hintMap' });

export const Module = z
  .strictObject({
    id: z
      .string()
      .regex(ID_PATTERN, { error: 'lowercase kebab-case (a-z, 0-9, "-"), 2–63 characters' })
      .meta({ description: 'Stable forever and equal to the file name. Renames need an `aliases` entry.' }),
    name: nonEmpty.meta({ description: 'Display name.' }),
    aliases: z.array(nonEmpty).optional().meta({ description: 'Old ids and search synonyms.' }),
    vendor: nonEmpty.optional(),
    category: z.enum(CATEGORIES),
    homepage: httpUrl.optional(),
    logo: nonEmpty.optional().meta({ description: '"simpleicons:<slug>" or a URL to an SVG in the repo.' }),
    description: z.string().max(200).optional().meta({ description: 'One line, at most 200 characters.' }),

    versionScheme: z
      .enum(VERSION_SCHEMES)
      .meta({ description: 'How versions are parsed and compared (docs/05).' }),
    versionRegex: regex(
      'Required for versionScheme: regex. Capture groups become numeric segments.',
    ).optional(),
    branchGroups: z
      .int()
      .min(1)
      .optional()
      .meta({ description: 'versionScheme: regex only: how many leading capture groups form the branch.' }),
    tagFilter: z
      .strictObject({
        include: regex('Only raw versions matching this count as releases.').optional(),
        exclude: regex('Raw versions matching this are ignored.').optional(),
      })
      .optional(),
    prerelease: z.enum(['skip', 'include']).default('skip'),

    releaseNotesUrl: z
      .string()
      .regex(/^https?:\/\/\S*\{version\}/, { error: 'an http(s) URL containing {version}' })
      .optional()
      .meta({
        description:
          'Per-release notes page, e.g. https://www.zabbix.com/rn/rn{version}; used as the release link.',
      }),
    tracks: z
      .array(Track)
      .optional()
      .meta({ description: 'Parallel supported release lines users can pin (ES 8/9, Debian 12/13).' }),
    defaultTrack: trackId.default(LATEST_TRACK).meta({ description: '"latest" (any track) or a track id.' }),

    sources: z.strictObject({
      releases: z.union([ReleaseSource, z.array(ReleaseSource).min(1)]).meta({
        description:
          'Where releases come from: one source, or several merged (the first to name a version wins; later ones fill in missing notes, dates and links).',
      }),
      releasesExtra: z
        .array(ReleaseSource)
        .optional()
        .meta({ description: 'Extra sources that enrich release notes.' }),
      security: z.array(SecuritySource).optional(),
      eol: EolSource.optional(),
    }),

    classify: z
      .strictObject({
        sections: HintMap.optional().meta({ description: 'Release-note headings that map to item types.' }),
        keywords: HintMap.optional().meta({ description: 'Keywords that mark an item as a type.' }),
      })
      .optional(),
    detect: z.array(DetectRule).optional().meta({ description: 'Version detectors; the first match wins.' }),
    maintainers: z
      .array(z.string().regex(/^@[A-Za-z0-9-]+$/, { error: 'expected a GitHub handle like @octocat' }))
      .optional(),
  })
  .superRefine((m, ctx) => {
    if (m.versionScheme === 'regex' && m.versionRegex === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['versionRegex'],
        message: 'required when versionScheme is regex',
      });
    }
    if (m.branchGroups !== undefined && m.versionScheme !== 'regex') {
      ctx.addIssue({
        code: 'custom',
        path: ['branchGroups'],
        message: 'only used with versionScheme: regex',
      });
    }
    const primaries = Array.isArray(m.sources.releases) ? m.sources.releases : [m.sources.releases];
    primaries.forEach((source, i) => {
      if (source.type === 'notes')
        ctx.addIssue({
          code: 'custom',
          path: ['sources', 'releases', ...(Array.isArray(m.sources.releases) ? [i] : []), 'type'],
          message: 'notes only enriches releases; use it in releasesExtra',
        });
    });
    const seen = new Set<string>();
    m.tracks?.forEach((t, i) => {
      if (t.id === LATEST_TRACK) {
        ctx.addIssue({ code: 'custom', path: ['tracks', i, 'id'], message: `"${LATEST_TRACK}" is reserved` });
      } else if (seen.has(t.id)) {
        ctx.addIssue({ code: 'custom', path: ['tracks', i, 'id'], message: `duplicate track id "${t.id}"` });
      }
      seen.add(t.id);
    });
    if (m.defaultTrack !== LATEST_TRACK && !seen.has(m.defaultTrack)) {
      ctx.addIssue({
        code: 'custom',
        path: ['defaultTrack'],
        message: `"${m.defaultTrack}" is not a track id; use "${LATEST_TRACK}" or one of: ${[...seen].join(', ') || '(no tracks)'}`,
      });
    }
  })
  .meta({
    allOf: [
      {
        if: { properties: { versionScheme: { const: 'regex' } }, required: ['versionScheme'] },
        then: { required: ['versionRegex'] },
      },
    ],
  });

/** A parsed module with defaults applied. */
export type Module = z.output<typeof Module>;
/** A module as written in YAML. */
export type ModuleInput = z.input<typeof Module>;

/** A module's primary release sources as a list (`sources.releases` may be one source or several). */
export const releaseSourcesOf = (module: Pick<Module, 'sources'>): ReleaseSource[] =>
  Array.isArray(module.sources.releases) ? module.sources.releases : [module.sources.releases];
