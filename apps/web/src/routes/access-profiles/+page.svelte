<script lang="ts">
  // Access profiles (docs/specs/fleet-ui.md §5.E), read-only for now: what each reaches and whether it works.
  import { pollBroken } from '@versiondrift/core';
  import { resolve } from '$app/paths';
  import Meta from '$lib/components/Meta.svelte';
  import FleetChip from '$lib/components/fleet/FleetChip.svelte';
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
  const failing = (profileId: number) =>
    fleet.data?.hosts.filter((h) => h.profileId === profileId && pollBroken(h.poll.state)) ?? [];
</script>

<Meta title="{t('profilesTitle')} · VersionDrift" description={t('appTagline')} />

<h1>{t('profilesTitle')}</h1>
<p class="note">{t('profilesNote')}</p>

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
</style>
