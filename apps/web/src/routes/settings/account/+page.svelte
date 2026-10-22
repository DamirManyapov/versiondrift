<script lang="ts">
  // Settings → Account: who is signed in, and the password when this instance keeps passwords.
  import { i18n } from '$lib/i18n/context';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const { t } = $derived(i18n());
  const PROBLEMS = {
    wrongPassword: 'wrongPassword',
    mismatch: 'passwordMismatch',
    tooShort: 'passwordTooShort',
  } as const;
</script>

<section>
  <h2>{t('accountTitle')}</h2>
  <p>
    <strong>{data.user.name}</strong>{#if data.user.email}
      · {data.user.email}{/if}
    · {t('accountRole', { role: data.user.role })}
  </p>

  {#if data.method === 'password'}
    <div class="password">
      <h3>{t('changePassword')}</h3>
      <form method="POST" action="?/password">
        <input
          class="hidden"
          name="name"
          autocomplete="username"
          value={data.user.name}
          readonly
          tabindex="-1"
        />
        <label>
          <span>{t('currentPassword')}</span>
          <input class="input" name="current" type="password" autocomplete="current-password" required />
        </label>
        <label>
          <span>{t('newPassword')}</span>
          <input
            class="input"
            name="next"
            type="password"
            autocomplete="new-password"
            minlength="8"
            required
          />
        </label>
        <label>
          <span>{t('repeatPassword')}</span>
          <input
            class="input"
            name="repeat"
            type="password"
            autocomplete="new-password"
            minlength="8"
            required
          />
        </label>
        {#if form && 'problem' in form && form.problem}
          <p class="error" role="alert">{t(PROBLEMS[form.problem])}</p>
        {:else if form && 'changed' in form}
          <p class="ok" role="status">{t('passwordChanged')}</p>
        {/if}
        <button class="btn btn-primary" type="submit">{t('changePassword')}</button>
      </form>
    </div>
  {:else if data.method === 'none'}
    <p class="muted">{t('authNone')}</p>
  {:else}
    <p class="muted">{t('accountExternal')}</p>
  {/if}
</section>

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  h2,
  h3,
  p {
    margin: 0;
  }
  h2 {
    font-size: 18px;
  }
  h3 {
    font-size: 16px;
    margin-bottom: 12px;
  }
  .password {
    max-width: 420px;
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
  .hidden {
    display: none;
  }
  .muted {
    color: var(--text-muted);
  }
  .error {
    color: var(--critical);
  }
  .ok {
    color: var(--ok);
  }
</style>
