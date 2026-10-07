<script lang="ts">
  // "Add hosts" (docs/specs/fleet-ui.md §5.D): one host through a form, or a CSV list with a line-by-line dry run,
  // then the import and a connection check with progress. A modal dialog: focus stays inside, Esc closes it.
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { fleetApi, type ImportPlanRow, type PollJob } from '$lib/fleet/api';
  import { pollSummary } from '$lib/fleet/labels';
  import { fleet, followJob } from '$lib/fleet/state.svelte';
  import { i18n } from '$lib/i18n/context';
  import { boardsApi } from '$lib/inventory/remote';
  import type { MessageKey } from '$lib/i18n';

  let {
    tab: initialTab,
    site,
    onclose,
  }: { tab: 'one' | 'csv'; site: number | undefined; onclose: () => void } = $props();
  const { t } = $derived(i18n());
  let dialog: HTMLDialogElement;
  let tab = $state<'one' | 'csv'>('one');
  onMount(() => {
    tab = initialTab;
    dialog.showModal();
  });

  const CSV_EXAMPLE = 'name,address,site,profile\nsrv-app-01,10.10.1.11,"Moscow, DC",Linux SSH';
  const KINDS: { id: string; key: MessageKey }[] = [
    { id: 'ssh-linux', key: 'kind_ssh_linux' },
    { id: 'windows', key: 'kind_windows' },
    { id: 'routeros', key: 'kind_routeros' },
    { id: 'proxmox', key: 'kind_proxmox' },
  ];

  // One host
  let name = $state('');
  let address = $state('');
  let siteId = $state('');
  let newSite = $state('');
  // The first profile by default; "no profile" is the last option.
  let profileId = $state(String(fleet.data?.profiles[0]?.id ?? ''));
  let kind = $state('ssh-linux');
  let busy = $state(false);
  let message = $state('');
  let problem = $state('');
  let added = $state<{ id: number; name: string } | undefined>();
  $effect(() => {
    if (siteId === '' && fleet.data?.sites.length) siteId = String(site ?? fleet.data.sites[0]!.id);
  });

  async function saveOne(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    problem = '';
    message = '';
    try {
      // "+ New site…": the site is made first, then the host goes there.
      if (siteId === 'new') {
        siteId = String((await boardsApi.create(newSite)).id);
        newSite = '';
        await fleet.load();
      }
      const { host, job } = await fleetApi.createHost({
        name,
        address,
        siteId: Number(siteId),
        profileId: profileId === '' ? null : Number(profileId),
        ...(profileId === '' && { kind }),
      });
      added = { id: host.id, name: host.name };
      message = t('hostAdded', { host: host.name });
      if (job) message = `${message} ${pollSummary(t, await followJob(job))}`;
      else await fleet.load();
      name = '';
      address = '';
    } catch (error) {
      problem = (error as Error).message;
    } finally {
      busy = false;
    }
  }

  // CSV
  let csv = $state('');
  let plan = $state<ImportPlanRow[] | undefined>();
  let progress = $state<PollJob | undefined>();
  let result = $state('');
  const counts = $derived({
    new: plan?.filter((r) => r.result === 'new').length ?? 0,
    unchanged: plan?.filter((r) => r.result === 'unchanged').length ?? 0,
    update: plan?.filter((r) => r.result === 'update').length ?? 0,
    error: plan?.filter((r) => r.result === 'error').length ?? 0,
  });
  const toWrite = $derived(counts.new + counts.update);
  const ordered = $derived(
    plan ? [...plan].sort((a, b) => Number(b.result === 'error') - Number(a.result === 'error')) : [],
  );

  async function readFile(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (file) {
      csv = await file.text();
      await check();
    }
  }

  async function check() {
    busy = true;
    problem = '';
    result = '';
    try {
      plan = (await fleetApi.planImport(csv)).rows;
    } catch (error) {
      problem = (error as Error).message;
    } finally {
      busy = false;
    }
  }

  async function runImport() {
    busy = true;
    problem = '';
    try {
      const answer = await fleetApi.runImport(csv);
      result = t('imported', { n: answer.created + answer.updated });
      if (answer.job) {
        progress = answer.job;
        const job = await followJob(answer.job, (j) => (progress = j));
        result = `${result} ${pollSummary(t, job)}`;
      } else await fleet.load();
      plan = undefined;
      progress = undefined;
    } catch (error) {
      problem = (error as Error).message;
    } finally {
      busy = false;
    }
  }

  const rowText = (row: ImportPlanRow) =>
    row.result === 'new'
      ? t('resultNew') + (row.newSite ? ` · ${t('newSiteNote')}` : '')
      : row.result === 'unchanged'
        ? t('resultUnchanged')
        : row.result === 'update'
          ? t('resultUpdate', { what: (row.changes ?? []).join(', ') })
          : (row.reason ?? t('resultError'));
</script>

<dialog bind:this={dialog} {onclose} aria-labelledby="add-hosts-title">
  <header>
    <h2 id="add-hosts-title">{t('addHosts')}</h2>
    <button class="btn btn-sm btn-ghost btn-icon" onclick={() => dialog.close()} aria-label={t('closeDialog')}
      >✕</button
    >
  </header>
  <div class="tabs" role="tablist">
    <button role="tab" aria-selected={tab === 'one'} onclick={() => (tab = 'one')}>{t('addOne')}</button>
    <button role="tab" aria-selected={tab === 'csv'} onclick={() => (tab = 'csv')}>{t('addCsv')}</button>
  </div>

  {#if tab === 'one'}
    <form onsubmit={saveOne}>
      <label
        >{t('fieldName')}<input
          bind:value={name}
          required
          class="input mono"
          placeholder="srv-app-01"
        /></label
      >
      <label
        >{t('fieldAddress')}<input
          bind:value={address}
          required
          class="input mono"
          placeholder="10.10.1.11"
        /><small>{t('addressHint')}</small></label
      >
      <label
        >{t('siteLabel')}
        <select class="input" bind:value={siteId}>
          {#each fleet.data?.sites ?? [] as s (s.id)}<option value={String(s.id)}>{s.name}</option>{/each}
          <option value="new">{t('newSiteOption')}</option>
        </select>
      </label>
      {#if siteId === 'new'}
        <label>{t('newSiteName')}<input class="input" bind:value={newSite} required maxlength="60" /></label>
      {/if}
      <label
        >{t('hostProfile')}
        <select class="input" bind:value={profileId}>
          {#each fleet.data?.profiles ?? [] as p (p.id)}<option value={String(p.id)}>{p.name}</option>{/each}
          <option value="">{t('noProfileOption')}</option>
        </select>
      </label>
      {#if profileId === ''}
        <label
          >{t('hostKind')}
          <select class="input" bind:value={kind}>
            {#each KINDS as k (k.id)}<option value={k.id}>{t(k.key)}</option>{/each}
          </select>
        </label>
      {/if}
      <div class="actions">
        <button class="btn btn-primary" type="submit" disabled={busy}
          >{busy ? t('polling') : profileId === '' ? t('save') : t('saveAndCheck')}</button
        >
      </div>
    </form>
    {#if message}
      <p role="status">
        {message}
        {#if added}<a href={resolve('/hosts/[id]', { id: String(added.id) })} onclick={() => dialog.close()}
            >{t('openHost', { host: added.name })}</a
          >{/if}
      </p>
    {/if}
  {:else}
    <p class="help">{t('csvHelp')}</p>
    <label>{t('csvFile')}<input type="file" accept=".csv,text/csv,text/plain" onchange={readFile} /></label>
    <label
      >{t('csvText')}
      <textarea bind:value={csv} rows="6" class="input mono" placeholder={CSV_EXAMPLE}></textarea>
    </label>
    <div class="actions">
      <button class="btn" onclick={() => void check()} disabled={busy || csv.trim() === ''}
        >{t('checkList')}</button
      >
      {#if plan}
        <button class="btn btn-primary" onclick={() => void runImport()} disabled={busy || toWrite === 0}
          >{toWrite === 0 ? t('importNothing') : t('importN', { n: toWrite })}</button
        >
      {/if}
    </div>
    {#if plan}
      <div class="counts">
        <span class="chip new">{t('planNew', { n: counts.new })}</span>
        <span class="chip">{t('planUnchanged', { n: counts.unchanged })}</span>
        <span class="chip update">{t('planUpdate', { n: counts.update })}</span>
        <span class="chip error">{t('planErrors', { n: counts.error })}</span>
      </div>
      <div class="table-wrap">
        <table>
          <tbody>
            {#each ordered as row (row.line)}
              <tr class={row.result}>
                <td class="muted">{t('planLine', { line: row.line })}</td>
                <td class="mono">{row.name}</td>
                <td class="mono">{row.address}</td>
                <td>{row.site}</td>
                <td>{row.profile || row.kind}</td>
                <td>{rowText(row)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
    {#if progress}
      <p role="status">{t('checking', { done: progress.done, total: progress.total })}</p>
      <progress max={progress.total} value={progress.done}></progress>
    {/if}
    {#if result}<p role="status">{result}</p>{/if}
  {/if}
  {#if problem}<p class="error" role="alert">{problem}</p>{/if}
</dialog>

<style>
  dialog {
    width: min(760px, calc(100vw - 32px));
    max-height: calc(100vh - 48px);
    padding: 22px 24px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text);
  }
  dialog::backdrop {
    background: rgba(8, 9, 10, 0.7);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  h2 {
    margin: 0;
    font-size: 20px;
  }
  .tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 16px;
    border-bottom: 1px solid var(--border);
  }
  .tabs button {
    display: flex;
    align-items: center;
    height: var(--control-h);
    padding: 0 14px;
    font-size: 14px;
    border-radius: var(--control-radius-sm) var(--control-radius-sm) 0 0;
    color: var(--text-muted);
    transition:
      background-color 0.12s,
      color 0.12s;
  }
  .tabs button:hover {
    color: var(--text);
    background: var(--surface-hover);
  }
  .tabs button:active {
    background: var(--surface-active);
  }
  .tabs button[aria-selected='true'] {
    color: var(--text);
    box-shadow: inset 0 -2px 0 var(--text);
  }
  form {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: var(--text-muted);
    margin-bottom: 10px;
  }
  .mono {
    font-family: var(--font-mono);
  }
  small {
    font-size: 12px;
  }
  .actions {
    grid-column: 1 / -1;
    display: flex;
    gap: 8px;
    margin: 4px 0 12px;
  }
  .help {
    font-size: 13px;
    color: var(--text-soft);
    margin: 0 0 12px;
  }
  .counts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 10px;
  }
  .chip {
    font-size: 12px;
    padding: 3px 9px;
    border-radius: 999px;
    border: 1px solid var(--border-strong);
  }
  .chip.new {
    color: var(--ok);
    border-color: var(--ok-border);
  }
  .chip.update {
    color: var(--update);
    border-color: var(--update-border);
  }
  .chip.error {
    color: var(--critical);
    border-color: var(--critical-border);
  }
  .table-wrap {
    max-height: 260px;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: 10px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  td {
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  tr.error td {
    color: var(--critical);
  }
  .muted {
    color: var(--text-muted);
  }
  .error {
    color: var(--critical);
  }
  progress {
    width: 100%;
  }
</style>
