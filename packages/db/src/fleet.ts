// The fleet (ADR-0007, docs/07 "Version detection"): hosts grouped by site (a site is a board), the access profiles
// that reach them, what each poll found and the history of changes. Secrets are sealed and never returned.
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Sealer } from './channels.ts';
import * as schema from './schema.ts';
import { StoreError, type Db } from './store.ts';

export type HostKind = (typeof schema.HOST_KINDS)[number];
export type PollStateName = (typeof schema.POLL_STATES)[number];

export interface AccessProfile {
  id: number;
  name: string;
  kind: HostKind;
  username: string;
  hasSecret: boolean;
  publicKey: string | null;
  hosts: number;
}

export interface AccessProfileInput {
  name: string;
  kind: HostKind;
  username: string;
  /** Password or token secret; sealed on write, never read back through the API. */
  secret?: string;
  /** SSH profiles: a key pair made by the instance (@versiondrift/detect); the private key is sealed. */
  keyPair?: { privateKey: string; publicKey: string };
}

export interface HostInstance {
  id: number;
  productId: string;
  version: string | null;
  track: string | null;
  label: string | null;
  source: 'detected' | 'manual';
  readRaw: string | null;
  detectedAt: string | null;
}

export interface HostRecord {
  id: number;
  name: string;
  address: string;
  port: number | null;
  kind: HostKind;
  siteId: number;
  profileId: number | null;
  poll: {
    state: PollStateName;
    since: string | null;
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    errorCode: string | null;
    errorMessage: string | null;
  };
  /** What the first contact pinned (trust on first use); null until then. */
  pins: { hostKey: string | null; tlsFingerprint: string | null };
  instances: HostInstance[];
}

export interface HostEvent {
  at: string;
  kind: 'version' | 'poll';
  productId: string | null;
  fromVersion: string | null;
  toVersion: string | null;
  pollState: PollStateName | null;
  message: string | null;
}

export interface HostInput {
  name: string;
  address: string;
  port?: number;
  kind: HostKind;
  siteId: number;
  profileId?: number | null;
}

/** What a poll found: the products a detector read, or why it could not read them. */
export type PollResult =
  | {
      ok: true;
      at: string;
      found: {
        productId: string;
        version: string | null;
        track?: string;
        label?: string;
        readRaw?: string;
      }[];
      /** Pins seen on this contact; stored when the host has none yet. */
      pins?: { hostKey?: string | null; tlsFingerprint?: string | null };
    }
  | {
      ok: false;
      at: string;
      state: 'unreachable' | 'auth-failed' | 'unknown';
      code: string;
      message: string;
    };

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

/**
 * What people type as a host's address: "host", "host:2026", "[fe80::1]:2026" or a bare IPv6 address. A missing port
 * (null) means the detector's default (SSH 22, Proxmox VE 8006, Backup Server 8007).
 */
export function splitAddress(text: string): { address: string; port: number | null } {
  const value = text.trim();
  const match = /^\[([^\]]+)\](?::(\d+))?$/.exec(value) ?? /^([^:\s]+):(\d+)$/.exec(value);
  if (!match) {
    if (/^[^:]*:[^:]*$/.test(value)) throw new StoreError(`"${value}": the port after ":" must be a number`);
    return { address: value, port: null };
  }
  const port = match[2] === undefined ? null : Number(match[2]);
  if (port !== null && (port < 1 || port > 65535))
    throw new StoreError(`"${value}": port ${port} is out of range (1–65535)`);
  return { address: match[1]!, port };
}

/** The address as people type it back: "host", "host:2026", "[fe80::1]:2026". */
export const joinAddress = (address: string, port: number | null): string =>
  port === null ? address : `${address.includes(':') ? `[${address}]` : address}:${port}`;

export class FleetStore {
  private readonly db: Db;
  private readonly sealer: Sealer;

  constructor(db: Db, sealer: Sealer) {
    this.db = db;
    this.sealer = sealer;
  }

  // ── Access profiles ────────────────────────────────────────────────────────────────────────────────

  profiles(): AccessProfile[] {
    const counts = new Map(
      this.db
        .select({ id: schema.hosts.accessProfileId, n: sql<number>`count(*)` })
        .from(schema.hosts)
        .where(isNotNull(schema.hosts.accessProfileId))
        .groupBy(schema.hosts.accessProfileId)
        .all()
        .map((r) => [r.id, r.n]),
    );
    return this.db
      .select()
      .from(schema.accessProfiles)
      .orderBy(asc(schema.accessProfiles.name))
      .all()
      .map((p) => ({
        id: p.id,
        name: p.name,
        kind: p.kind,
        username: p.username,
        hasSecret: p.secret !== null || p.privateKey !== null,
        publicKey: p.publicKey,
        hosts: counts.get(p.id) ?? 0,
      }));
  }

  createProfile(input: AccessProfileInput): AccessProfile {
    const name = input.name.trim();
    if (name === '' || name.length > 80) throw new StoreError('a profile name has 1–80 characters');
    if (input.username.trim() === '') throw new StoreError('a profile needs a user name');
    if (this.profiles().some((p) => p.name.toLowerCase() === name.toLowerCase()))
      throw new StoreError(`a profile named "${name}" already exists`);
    const keys = input.keyPair;
    const row = this.db
      .insert(schema.accessProfiles)
      .values({
        name,
        kind: input.kind,
        username: input.username.trim(),
        secret: input.secret ? this.sealer.seal(input.secret) : null,
        privateKey: keys ? this.sealer.seal(keys.privateKey) : null,
        publicKey: keys?.publicKey ?? null,
      })
      .returning({ id: schema.accessProfiles.id })
      .get();
    return this.profiles().find((p) => p.id === row.id)!;
  }

  /** Replaces the secret (the UI never shows the old one). */
  setProfileSecret(id: number, secret: string): void {
    const result = this.db
      .update(schema.accessProfiles)
      .set({ secret: this.sealer.seal(secret), updatedAt: new Date().toISOString() })
      .where(eq(schema.accessProfiles.id, id))
      .run();
    if (result.changes === 0) throw new StoreError(`no access profile ${id}`);
  }

  /** The profile's credentials for the poller only. */
  profileCredentials(id: number): { username: string; secret: string | null; privateKey: string | null } {
    const p = this.db.select().from(schema.accessProfiles).where(eq(schema.accessProfiles.id, id)).get();
    if (!p) throw new StoreError(`no access profile ${id}`);
    return {
      username: p.username,
      secret: p.secret === null ? null : this.sealer.open(p.secret),
      privateKey: p.privateKey === null ? null : this.sealer.open(p.privateKey),
    };
  }

  deleteProfile(id: number): void {
    const result = this.db.delete(schema.accessProfiles).where(eq(schema.accessProfiles.id, id)).run();
    if (result.changes === 0) throw new StoreError(`no access profile ${id}`);
  }

  // ── Hosts ──────────────────────────────────────────────────────────────────────────────────────────

  hosts(siteId?: number): HostRecord[] {
    const rows = this.db
      .select()
      .from(schema.hosts)
      .where(siteId === undefined ? undefined : eq(schema.hosts.boardId, siteId))
      .orderBy(asc(schema.hosts.name))
      .all();
    const instances = rows.length
      ? this.db
          .select()
          .from(schema.instances)
          .where(
            inArray(
              schema.instances.hostId,
              rows.map((r) => r.id),
            ),
          )
          .orderBy(asc(schema.instances.position), asc(schema.instances.id))
          .all()
      : [];
    const byHost = new Map<number, HostInstance[]>();
    for (const i of instances) {
      const list = byHost.get(i.hostId!) ?? [];
      list.push({
        id: i.id,
        productId: i.productId,
        version: i.version,
        track: i.track,
        label: i.label,
        source: i.source === 'detector' ? 'detected' : 'manual',
        readRaw: i.readRaw,
        detectedAt: i.detectedAt,
      });
      byHost.set(i.hostId!, list);
    }
    return rows.map((h) => ({
      id: h.id,
      name: h.name,
      address: h.address,
      port: h.port,
      kind: h.kind,
      siteId: h.boardId,
      profileId: h.accessProfileId,
      poll: {
        state: h.pollState,
        since: h.pollSince,
        lastAttemptAt: h.lastAttemptAt,
        lastSuccessAt: h.lastSuccessAt,
        errorCode: h.pollErrorCode,
        errorMessage: h.pollErrorMessage,
      },
      pins: { hostKey: h.hostKey, tlsFingerprint: h.tlsFingerprint },
      instances: byHost.get(h.id) ?? [],
    }));
  }

  host(id: number): (HostRecord & { events: HostEvent[] }) | undefined {
    const host = this.hosts().find((h) => h.id === id);
    if (!host) return undefined;
    const events = this.db
      .select()
      .from(schema.hostEvents)
      .where(eq(schema.hostEvents.hostId, id))
      .orderBy(desc(schema.hostEvents.at), desc(schema.hostEvents.id))
      .all()
      .map(({ at, kind, productId, fromVersion, toVersion, pollState, message }) => ({
        at,
        kind,
        productId,
        fromVersion,
        toVersion,
        pollState,
        message,
      }));
    return { ...host, events };
  }

  createHost(input: HostInput): HostRecord {
    const name = input.name.trim();
    if (!NAME.test(name)) throw new StoreError(`"${name}" is not a host name (letters, digits, . _ -)`);
    const { address, port } =
      input.port === undefined
        ? splitAddress(input.address)
        : { address: input.address.trim(), port: input.port };
    if (address === '') throw new StoreError('a host needs an address');
    this.checkSite(input.siteId);
    if (input.profileId != null) this.checkProfile(input.profileId, input.kind);
    if (this.db.select().from(schema.hosts).where(eq(schema.hosts.name, name)).get())
      throw new StoreError(`a host named "${name}" already exists`);
    const row = this.db
      .insert(schema.hosts)
      .values({
        name,
        address,
        port,
        kind: input.kind,
        boardId: input.siteId,
        accessProfileId: input.profileId ?? null,
        pollState: input.profileId == null ? 'none' : 'pending',
      })
      .returning({ id: schema.hosts.id })
      .get();
    return this.hosts().find((h) => h.id === row.id)!;
  }

  /**
   * "host" or "host:port" (see splitAddress); an address without a port goes back to the default port. A new address
   * is another machine as far as pins go: the host key and certificate are pinned again, and the host waits for its
   * next poll instead of showing the old address's problem.
   */
  setAddress(id: number, text: string): void {
    const { address, port } = splitAddress(text);
    if (address === '') throw new StoreError('a host needs an address');
    const host = this.db.select().from(schema.hosts).where(eq(schema.hosts.id, id)).get();
    if (!host) throw new StoreError(`no host ${id}`);
    if (host.address === address && host.port === port) return;
    this.db
      .update(schema.hosts)
      .set({
        address,
        port,
        hostKey: null,
        tlsFingerprint: null,
        updatedAt: new Date().toISOString(),
        ...(host.accessProfileId !== null && {
          pollState: 'pending' as const,
          pollSince: null,
          pollErrorCode: null,
          pollErrorMessage: null,
        }),
      })
      .where(eq(schema.hosts.id, id))
      .run();
  }

  /** Hosts added before ports were parsed kept "10.0.0.5:2026" as the address: split them (run at start). */
  normalizeAddresses(): number {
    let fixed = 0;
    for (const host of this.db.select().from(schema.hosts).all()) {
      if (host.port !== null || !host.address.includes(':')) continue;
      try {
        const parts = splitAddress(host.address);
        if (parts.port === null) continue;
        this.setAddress(host.id, host.address);
        fixed++;
      } catch {
        // An address that doesn't parse stays as it is; the poll reports it.
      }
    }
    return fixed;
  }

  /** Forgets the pinned host key and certificate (a host was reinstalled): the next contact pins them again. */
  resetPins(id: number): void {
    const result = this.db
      .update(schema.hosts)
      .set({ hostKey: null, tlsFingerprint: null })
      .where(eq(schema.hosts.id, id))
      .run();
    if (result.changes === 0) throw new StoreError(`no host ${id}`);
  }

  deleteHosts(ids: number[]): number {
    if (ids.length === 0) return 0;
    return this.db.delete(schema.hosts).where(inArray(schema.hosts.id, ids)).run().changes;
  }

  /** Moves hosts, with their products, to another site. */
  moveHosts(ids: number[], siteId: number): void {
    this.checkSite(siteId);
    if (ids.length === 0) return;
    this.db.transaction((tx) => {
      tx.update(schema.hosts).set({ boardId: siteId }).where(inArray(schema.hosts.id, ids)).run();
      tx.update(schema.instances).set({ boardId: siteId }).where(inArray(schema.instances.hostId, ids)).run();
    });
  }

  /** Sets (or clears) the access profile; a host with a new profile waits for its next poll. */
  setProfile(ids: number[], profileId: number | null): void {
    if (ids.length === 0) return;
    const hosts = this.db.select().from(schema.hosts).where(inArray(schema.hosts.id, ids)).all();
    if (profileId !== null) for (const h of hosts) this.checkProfile(profileId, h.kind);
    this.db
      .update(schema.hosts)
      .set({
        accessProfileId: profileId,
        pollState: profileId === null ? 'none' : 'pending',
        pollSince: null,
        pollErrorCode: null,
        pollErrorMessage: null,
      })
      .where(inArray(schema.hosts.id, ids))
      .run();
  }

  /** A product typed by hand on a host; polls never overwrite it. */
  addManual(hostId: number, productId: string, version: string, track?: string): void {
    const host = this.db.select().from(schema.hosts).where(eq(schema.hosts.id, hostId)).get();
    if (!host) throw new StoreError(`no host ${hostId}`);
    this.db
      .insert(schema.instances)
      .values({
        boardId: host.boardId,
        hostId,
        productId,
        version,
        track: track ?? null,
        source: 'manual',
        position: this.nextPosition(host.boardId),
      })
      .run();
  }

  /**
   * Stores a poll: on success the detected products replace the previous detected ones (manual ones stay) and each
   * version change becomes an event; on failure the last detected versions stay and the state changes. A state
   * change is an event too, and `since` keeps the moment the current state began.
   */
  recordPoll(hostId: number, result: PollResult): void {
    const host = this.db.select().from(schema.hosts).where(eq(schema.hosts.id, hostId)).get();
    if (!host) throw new StoreError(`no host ${hostId}`);
    const state: PollStateName = result.ok ? 'ok' : result.state;
    const changed = state !== host.pollState;
    this.db.transaction((tx) => {
      tx.update(schema.hosts)
        .set({
          pollState: state,
          pollSince: changed ? result.at : host.pollSince,
          lastAttemptAt: result.at,
          ...(result.ok && { lastSuccessAt: result.at }),
          pollErrorCode: result.ok ? null : result.code,
          pollErrorMessage: result.ok ? null : result.message,
          ...(result.ok && !host.hostKey && result.pins?.hostKey && { hostKey: result.pins.hostKey }),
          ...(result.ok &&
            !host.tlsFingerprint &&
            result.pins?.tlsFingerprint && { tlsFingerprint: result.pins.tlsFingerprint }),
          updatedAt: result.at,
        })
        .where(eq(schema.hosts.id, hostId))
        .run();
      if (changed && host.pollState !== 'pending')
        tx.insert(schema.hostEvents)
          .values({
            hostId,
            at: result.at,
            kind: 'poll',
            pollState: state,
            message: result.ok ? null : result.message,
          })
          .run();
      if (!result.ok) return;
      const previous = tx
        .select()
        .from(schema.instances)
        .where(and(eq(schema.instances.hostId, hostId), eq(schema.instances.source, 'detector')))
        .all();
      const before = new Map(previous.map((i) => [i.productId, i]));
      tx.delete(schema.instances)
        .where(and(eq(schema.instances.hostId, hostId), eq(schema.instances.source, 'detector')))
        .run();
      let position = this.nextPosition(host.boardId);
      for (const f of result.found) {
        tx.insert(schema.instances)
          .values({
            boardId: host.boardId,
            hostId,
            productId: f.productId,
            version: f.version,
            track: f.track ?? null,
            label: f.label ?? null,
            source: 'detector',
            readRaw: f.readRaw ?? null,
            detectedAt: result.at,
            position: position++,
          })
          .run();
        const old = before.get(f.productId);
        if (host.pollState !== 'pending' && (old?.version ?? null) !== f.version)
          tx.insert(schema.hostEvents)
            .values({
              hostId,
              at: result.at,
              kind: 'version',
              productId: f.productId,
              fromVersion: old?.version ?? null,
              toVersion: f.version,
            })
            .run();
      }
    });
  }

  /** An event from outside a poll (the demo seed's history). */
  addEvent(
    hostId: number,
    event: Omit<HostEvent, 'productId' | 'fromVersion' | 'toVersion' | 'pollState'> & Partial<HostEvent>,
  ): void {
    this.db
      .insert(schema.hostEvents)
      .values({
        hostId,
        at: event.at,
        kind: event.kind,
        productId: event.productId ?? null,
        fromVersion: event.fromVersion ?? null,
        toVersion: event.toVersion ?? null,
        pollState: event.pollState ?? null,
        message: event.message ?? null,
      })
      .run();
  }

  private nextPosition(boardId: number): number {
    const row = this.db
      .select({ max: sql<number>`coalesce(max(${schema.instances.position}), -1)` })
      .from(schema.instances)
      .where(eq(schema.instances.boardId, boardId))
      .get();
    return (row?.max ?? -1) + 1;
  }

  private checkSite(siteId: number): void {
    if (!this.db.select().from(schema.boards).where(eq(schema.boards.id, siteId)).get())
      throw new StoreError(`no site ${siteId}`);
  }

  private checkProfile(profileId: number, kind: HostKind): void {
    const p = this.db
      .select()
      .from(schema.accessProfiles)
      .where(eq(schema.accessProfiles.id, profileId))
      .get();
    if (!p) throw new StoreError(`no access profile ${profileId}`);
    if (p.kind !== kind) throw new StoreError(`profile "${p.name}" is for ${p.kind} hosts, not ${kind}`);
  }
}
