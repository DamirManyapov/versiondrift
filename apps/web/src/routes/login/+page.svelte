<script lang="ts">
  import { resolve } from '$app/paths';
  import Meta from '$lib/components/Meta.svelte';
  import { i18n } from '$lib/i18n/context';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const { t } = $derived(i18n());
</script>

<Meta title="{t('signInTitle')} · VersionDrift" canonical={false} />

<div class="page">
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
      class="primary"
      href="{resolve('/auth/oidc/start')}?next={encodeURIComponent(data.next)}"
      data-sveltekit-reload>{t('signInOidc')}</a
    >
  {:else}
    <p>{t('signInHeader', { header: data.header })}</p>
  {/if}
</div>

<style>
  .page {
    max-width: 380px;
    margin: 64px auto;
    display: flex;
    flex-direction: column;
    gap: 20px;
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
