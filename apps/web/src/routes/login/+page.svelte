<script lang="ts">
  import { resolve } from '$app/paths';
  import Meta from '$lib/components/Meta.svelte';
  import { i18n } from '$lib/i18n/context';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const { t } = $derived(i18n());
</script>

<Meta title="{t('signInTitle')} · VersionDrift" canonical={false} />

<!-- A card in the middle of the screen, the logo above the form (UI audit, sign-in). -->
<div class="page">
  <div class="card">
    <span class="logo" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="26" height="26"
        ><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><path d="M12 12 L19 5" /><circle
          cx="12"
          cy="12"
          r="1.2"
        /></svg
      >
    </span>
    <h1>{t('signInTitle')}</h1>
    {#if data.method === 'password'}
      <form method="POST">
        <label>
          <span>{t('signInName')}</span>
          <input class="input" name="name" autocomplete="username" value={form?.name ?? ''} required />
        </label>
        <label>
          <span>{t('signInPassword')}</span>
          <input class="input" name="password" type="password" autocomplete="current-password" required />
        </label>
        {#if form?.problem}
          <p class="error" role="alert">
            {form.problem === 'tooMany' ? t('signInTooMany') : t('signInInvalid')}
          </p>
        {/if}
        <button class="btn btn-primary" type="submit">{t('signInButton')}</button>
      </form>
    {:else if data.method === 'oidc'}
      <a
        class="btn btn-primary"
        href="{resolve('/auth/oidc/start')}?next={encodeURIComponent(data.next)}"
        data-sveltekit-reload>{t('signInOidc')}</a
      >
    {:else}
      <p>{t('signInHeader', { header: data.header })}</p>
    {/if}
  </div>
</div>

<style>
  .page {
    min-height: calc(100vh - 220px);
    display: grid;
    place-items: center;
    padding: 24px 0;
  }
  .card {
    width: min(400px, 100%);
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 28px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
  }
  .logo {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    background: var(--update);
    color: var(--on-update);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .logo svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
  }
  h1 {
    margin: 0;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 14px;
  }
  .error {
    color: var(--critical);
    margin: 0;
  }
</style>
