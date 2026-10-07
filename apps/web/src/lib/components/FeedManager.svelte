<script lang="ts">
  // Settings, self-hosted: the local feed copy (docs/07 "Feed sync", "Offline feed package"): where updates come
  // from, "Check for updates", uploading an offline package, and this copy as a package for an instance without Internet.
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import type { SyncState } from '@versiondrift/feed';
  import { feed } from '$lib/feed/state.svelte';
  import { formatUpdated } from '$lib/format';
  import { i18n } from '$lib/i18n/context';

  const PACKAGE_URL = 'https://feed.versiondrift.dev/versiondrift-feed.tar.gz';
  const { t, locale } = $derived(i18n());
  const admin = $derived(page.data.account?.role !== 'viewer');

  let info = $state<{ state: SyncState; source: string | null; importDir: string } | undefined>();
  let busy = $state(false);
  let notice = $state('');
  let problem = $state('');

  async function load() {
    const response = await fetch('/api/feed');
    if (response.ok) info = (await response.json()) as typeof info;
  }
  onMount(load);

  async function run(action: () => Promise<Response>, success: (body: { changed?: boolean }) => string) {
    busy = true;
    notice = '';
    problem = '';
    try {
      const response = await action();
      const body = (await response.json().catch(() => ({}))) as { message?: string; changed?: boolean };
      if (!response.ok) throw new Error(body.message ?? `HTTP ${response.status}`);
      await load();
      notice = success(body);
      await feed.load(true);
    } catch (error) {
      problem = (error as Error).message;
    } finally {
      busy = false;
    }
  }

  const checkNow = () =>
    run(
      () => fetch('/api/feed/sync', { method: 'POST' }),
      () => t('feedChecked'),
    );

  async function upload(event: Event & { currentTarget: HTMLInputElement }) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    await run(
      () =>
        fetch('/api/feed/import', {
          method: 'POST',
          headers: { 'content-type': 'application/gzip' },
          body: file,
        }),
      (body) =>
        body.changed && info?.state.generatedAt
          ? t('feedImported', { generated: formatUpdated(info.state.generatedAt, locale, t) })
          : t('feedAlreadyHere'),
    );
  }
</script>

<section>
  <h2>{t('feedTitle')}</h2>
  {#if info}
    <p>
      {#if info.state.generatedAt}
        {t('feedBuilt', {
          generated: formatUpdated(info.state.generatedAt, locale, t),
          n: info.state.products,
        })}
        {#if info.state.verified}· {t('mirrorVerified')}{/if}
      {:else}
        {t('feedNone')}
      {/if}
    </p>
    <p class="muted">
      {#if info.source}
        {t('feedSourceNetwork', { url: info.source })}
        {#if info.state.syncedAt}{t('feedLastCheck', {
            at: formatUpdated(info.state.syncedAt, locale, t),
          })}{/if}
      {:else}
        {t('feedSourceOff')}
      {/if}
    </p>
    {#if info.state.lastError}<p class="error">{t('mirrorError', { message: info.state.lastError })}</p>{/if}
    {#if admin}
      <div class="actions">
        <button class="btn btn-sm" onclick={checkNow} disabled={busy}
          >{busy ? t('feedWorking') : t('feedCheckNow')}</button
        >
        <label class="btn btn-sm upload" aria-disabled={busy}>
          {t('feedUpload')}
          <input
            type="file"
            accept=".gz,.tgz,.tar,application/gzip"
            onchange={upload}
            disabled={busy}
            class="visually-hidden"
          />
        </label>
        {#if info.state.generatedAt}
          <a class="btn btn-sm" href={resolve('/feed/versiondrift-feed.tar.gz')} download
            >{t('feedDownload')}</a
          >
        {/if}
      </div>
    {/if}
    <p class="muted">{t('feedOfflineHelp', { url: PACKAGE_URL, dir: info.importDir })}</p>
  {/if}
  {#if notice}<p class="ok" role="status">{notice}</p>{/if}
  {#if problem}<p class="error" role="alert">{problem}</p>{/if}
</section>

<style>
  p {
    margin: 0 0 8px;
  }
  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
    margin: 12px 0;
  }
  .upload:focus-within {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  .muted {
    color: var(--text-muted);
    font-size: 13px;
    overflow-wrap: anywhere;
  }
  .error {
    color: var(--critical);
    font-size: 13px;
  }
  .ok {
    color: var(--ok);
    font-size: 13px;
  }
</style>
