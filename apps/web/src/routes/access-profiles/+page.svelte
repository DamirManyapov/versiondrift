<script lang="ts">
  // Access profiles (docs/specs/fleet-ui.md §5.E), read-only for now: what each reaches and whether it works.
  import { pollBroken } from '@versiondrift/core';
  import { resolve } from '$app/paths';
  import Meta from '$lib/components/Meta.svelte';
  import FleetChip from '$lib/components/fleet/FleetChip.svelte';
  import CodeCopy from '$lib/components/fleet/CodeCopy.svelte';
  import { page } from '$app/state';
  import { fleetApi } from '$lib/fleet/api';
  import { fleet } from '$lib/fleet/state.svelte';
  import { i18n } from '$lib/i18n/context';
  import type { MessageKey } from '$lib/i18n';

  const { t } = $derived(i18n());
  const KIND: Record<string, MessageKey> = {
    'ssh-linux': 'kind_ssh_linux',
    windows: 'kind_windows',
    routeros: 'kind_routeros',
    proxmox: 'kind_proxmox',
  };
  const canEdit = $derived(page.data.account?.role !== 'viewer');
  let open = $state<{ id: number; what: 'secret' | 'key' | 'delete' } | undefined>();
  let secret = $state('');
  let message = $state('');
  let problem = $state('');

  async function act(action: () => Promise<void>, done: string) {
    problem = '';
    try {
      await action();
      message = done;
      open = undefined;
      secret = '';
      await fleet.load();
    } catch (error) {
      problem = (error as Error).message;
    }
  }

  const failing = (profileId: number) =>
    fleet.data?.hosts.filter((h) => h.profileId === profileId && pollBroken(h.poll.state)) ?? [];
</script>

<Meta title="{t('profilesTitle')} · VersionDrift" description={t('appTagline')} />

<div class="top">
  <h1>{t('profilesTitle')}</h1>
  {#if canEdit}<a class="btn btn-primary" href={resolve('/access-profiles/new')}>+ {t('newProfile')}</a>{/if}
</div>
<p class="note">{t('profilesNote')}</p>
{#if message}<p role="status">{message}</p>{/if}
{#if problem}<p class="error" role="alert">{problem}</p>{/if}

{#if fleet.data}
  <ul class="profiles">
    {#each fleet.data.profiles as profile (profile.id)}
      {@const bad = failing(profile.id)}
      <li>
        <div class="grow">
          <h2>{profile.name}</h2>
          <p class="muted">
            {t(KIND[profile.kind] ?? 'kind_ssh_linux')} · <span class="mono">{profile.username}</span> ·
            {profile.hasSecret ? t('profileSecretSet') : t('profileNoSecret')}
          </p>
          {#if bad.length > 0}
            <p class="bad">
              {#each bad as host, i (host.id)}{#if i > 0},
                {/if}<a class="mono" href={resolve('/hosts/[id]', { id: String(host.id) })}>{host.name}</a
                >{/each}
            </p>
          {/if}
        </div>
        <span class="muted">{t('hosts', { n: profile.hosts })}</span>
        {#if bad.length > 0}
          <FleetChip status="critical" label={t('profileFailing', { n: bad.length })} />
        {:else}
          <FleetChip status="ok" label={t('profileWorks')} />
        {/if}
        {#if canEdit}
          <div class="acts">
            {#if profile.publicKey}
              <button
                type="button"
                class="btn btn-sm"
                onclick={() =>
                  (open =
                    open?.id === profile.id && open.what === 'key'
                      ? undefined
                      : { id: profile.id, what: 'key' })}>{t('showPublicKey')}</button
              >
            {:else}
              <button
                type="button"
                class="btn btn-sm"
                onclick={() => (open = { id: profile.id, what: 'secret' })}>{t('replaceSecret')}</button
              >
            {/if}
            <button
              type="button"
              class="btn btn-sm btn-danger-ghost delete"
              onclick={() => (open = { id: profile.id, what: 'delete' })}>{t('deleteProfile')}</button
            >
          </div>
        {/if}
        {#if open?.id === profile.id}
          <div class="drawer">
            {#if open.what === 'key' && profile.publicKey}
              <CodeCopy code={profile.publicKey} />
            {:else if open.what === 'secret'}
              <form
                onsubmit={(e) => {
                  e.preventDefault();
                  void act(() => fleetApi.replaceSecret(profile.id, secret), t('secretReplaced'));
                }}
              >
                <input
                  class="input input-sm"
                  type="password"
                  bind:value={secret}
                  required
                  autocomplete="off"
                  aria-label={t('replaceSecret')}
                />
                <button class="btn btn-sm btn-primary" type="submit">{t('save')}</button>
                <button class="btn btn-sm" type="button" onclick={() => (open = undefined)}
                  >{t('cancel')}</button
                >
              </form>
            {:else if open.what === 'delete'}
              <!-- An inline confirmation (no browser dialog) that says what happens to the hosts (UI audit P1-5). -->
              <div class="confirm" role="alert">
                <span
                  ><strong>{t('deleteProfileAsk', { name: profile.name })}</strong>
                  {profile.hosts > 0 ? t('profileUsedBy', { n: profile.hosts }) : t('profileUnused')}</span
                >
                <button type="button" class="btn btn-sm" onclick={() => (open = undefined)}
                  >{t('cancel')}</button
                >
                <button
                  type="button"
                  class="btn btn-sm btn-danger"
                  onclick={() => void act(() => fleetApi.deleteProfile(profile.id), t('profileDeleted'))}
                  >{t('deleteProfile')}</button
                >
              </div>
            {/if}
          </div>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  h1 {
    margin: 0 0 8px;
    font-size: 26px;
  }
  .note {
    color: var(--text-soft);
    max-width: 70ch;
  }
  .profiles {
    list-style: none;
    margin: 20px 0 0;
    padding: 0;
    display: grid;
    gap: 12px;
  }
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px;
    padding: 16px 18px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
  }
  .grow {
    flex: 1;
  }
  h2 {
    margin: 0 0 4px;
    font-size: 16px;
  }
  p {
    margin: 0;
  }
  .muted {
    color: var(--text-muted);
    font-size: 13px;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .bad {
    margin-top: 6px;
    font-size: 13px;
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .acts,
  .drawer,
  form {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
  }
  /* "Delete" stands apart from the other actions. */
  .delete {
    margin-left: 8px;
  }
  .confirm {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--critical-border);
    border-radius: 10px;
  }
  .confirm span {
    flex: 1 1 260px;
  }
  .drawer {
    flex-basis: 100%;
  }
  .drawer :global(.code) {
    flex: 1;
  }
  .error {
    color: var(--critical);
  }
</style>
