<script lang="ts">
  // New access profile (docs/specs/fleet-ui.md §5.E): type → how to create the least-privilege account → details,
  // save and test on a host of that type. Step and type live in the URL (?type=…&step=…).
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import Meta from '$lib/components/Meta.svelte';
  import CodeCopy from '$lib/components/fleet/CodeCopy.svelte';
  import { fleetApi, type AccessProfile, type TestResult } from '$lib/fleet/api';
  import { fill, instructions, KIND_OF, PROFILE_TYPES, type ProfileType } from '$lib/fleet/instructions';
  import { feed } from '$lib/feed/state.svelte';
  import { fleet } from '$lib/fleet/state.svelte';
  import { i18n } from '$lib/i18n/context';

  const { t, locale } = $derived(i18n());
  const type = $derived(
    (PROFILE_TYPES as string[]).includes(page.url.searchParams.get('type') ?? '')
      ? (page.url.searchParams.get('type') as ProfileType)
      : undefined,
  );
  const step = $derived(type ? Math.min(3, Math.max(2, Number(page.url.searchParams.get('step') ?? 2))) : 1);
  const how = $derived(type ? instructions(locale, type) : undefined);
  const instance = $derived(page.url.hostname);

  function go(next: { type?: ProfileType; step?: number }) {
    const url = new URL(page.url);
    if (next.type) url.searchParams.set('type', next.type);
    url.searchParams.set('step', String(next.step ?? 2));
    // eslint-disable-next-line svelte/no-navigation-without-resolve -- same page, only the query changes
    void goto(url, { noScroll: false });
  }

  let name = $state('');
  let user = $state('');
  let secret = $state('');
  let busy = $state(false);
  let problem = $state('');
  let saved = $state<AccessProfile | undefined>();
  let testHost = $state('');
  let test = $state<TestResult | undefined>();
  $effect(() => {
    if (how && !saved) {
      name ||= how.name;
      user ||= how.user;
    }
  });
  const hostsOfKind = $derived(type ? (fleet.data?.hosts.filter((h) => h.kind === KIND_OF[type]) ?? []) : []);

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (!type) return;
    busy = true;
    problem = '';
    try {
      saved = await fleetApi.createProfile({
        name,
        kind: KIND_OF[type],
        username: user,
        ...(secret && { secret }),
      });
      secret = '';
      await fleet.load();
    } catch (error) {
      problem = (error as Error).message;
    } finally {
      busy = false;
    }
  }

  async function runTest() {
    if (!saved || testHost === '') return;
    busy = true;
    try {
      test = await fleetApi.testProfile(saved.id, Number(testHost));
    } catch (error) {
      test = { ok: false, state: 'unknown', code: 'error', message: (error as Error).message };
    } finally {
      busy = false;
    }
  }
  const nameOf = (id: string) => feed.index?.products[id]?.name ?? id;
</script>

<Meta title="{t('newProfile')} · VersionDrift" description={t('appTagline')} />

<nav class="crumbs"><a href={resolve('/access-profiles')}>{t('profilesTitle')}</a> /</nav>
<h1>{t('newProfile')}</h1>
<ol class="steps" aria-label={t('stepOf', { n: step })}>
  <li class:on={step === 1}>{t('wizardType')}</li>
  <li class:on={step === 2}>{t('wizardHow')}</li>
  <li class:on={step === 3}>{t('wizardData')}</li>
</ol>

{#if step === 1}
  <div class="types">
    {#each PROFILE_TYPES as id (id)}
      {@const it = instructions(locale, id)}
      <button class="type" onclick={() => go({ type: id, step: 2 })}>
        <strong>{it.label}</strong><span class="muted">{it.transport}</span>
      </button>
    {/each}
  </div>
{:else if how && step === 2}
  <section class="how">
    <p class="lead">{how.lead}</p>
    <ol class="numbered">
      {#each how.steps as s, i (i)}
        <li>
          <span>{fill(s.text, { instance })}</span>
          {#if s.code}<CodeCopy code={fill(s.code, { instance })} />{/if}
        </li>
      {/each}
    </ol>
    <p class="note">{fill(how.note, { instance })}</p>
    <div class="actions">
      <a class="button" href={resolve('/access-profiles/new')}>{t('back')}</a>
      <button class="primary" onclick={() => go({ step: 3 })}>{t('next')}</button>
    </div>
  </section>
{:else if how && type}
  {#if !saved}
    <form onsubmit={save}>
      <label>{t('profileName')}<input bind:value={name} required /></label>
      <label>{t('profileUser')}<input class="mono" bind:value={user} required /></label>
      {#if how.secret}<label
          >{how.secret}<input type="password" bind:value={secret} required autocomplete="off" /></label
        >{/if}
      <p class="muted small">{how.rights}</p>
      <div class="actions">
        <button type="button" onclick={() => go({ step: 2 })}>{t('back')}</button>
        <button class="primary" type="submit" disabled={busy}>{t('saveProfile')}</button>
      </div>
    </form>
  {:else}
    <p role="status" class="saved">{t('profileSaved', { name: saved.name })}</p>
    {#if saved.publicKey}
      <p>{t('publicKeyTitle')}</p>
      <CodeCopy code={fill(how.steps[2]?.code ?? '', { instance, key: saved.publicKey })} />
    {/if}
    <section class="test">
      <h2>{t('testOnHost')}</h2>
      {#if hostsOfKind.length === 0}
        <p class="muted">{t('noHostsOfKind')}</p>
      {:else}
        <div class="row">
          <select bind:value={testHost} aria-label={t('testOnHost')}>
            <option value="" disabled>—</option>
            {#each hostsOfKind as h (h.id)}<option value={String(h.id)}>{h.name} · {h.address}</option>{/each}
          </select>
          <button onclick={() => void runTest()} disabled={busy || testHost === ''}>{t('testRun')}</button>
        </div>
        {#if test}
          <p role="status" class={test.ok ? 'ok' : 'bad'}>
            {test.ok
              ? test.found.length
                ? t('testFound', {
                    list: test.found.map((f) => `${nameOf(f.productId)} ${f.version ?? ''}`).join(', '),
                  })
                : t('testNothing')
              : t('testFailed', { message: test.message })}
          </p>
        {/if}
      {/if}
    </section>
    <div class="actions"><a class="button primary" href={resolve('/access-profiles')}>{t('done')}</a></div>
  {/if}
  {#if problem}<p class="error" role="alert">{problem}</p>{/if}
{/if}

<style>
  .crumbs {
    font-size: 13px;
    margin-bottom: 8px;
  }
  h1 {
    margin: 0 0 12px;
    font-size: 26px;
  }
  h2 {
    font-size: 16px;
    margin: 0 0 8px;
  }
  .steps {
    display: flex;
    gap: 8px;
    list-style: none;
    padding: 0;
    margin: 0 0 20px;
    counter-reset: step;
  }
  .steps li {
    counter-increment: step;
    padding: 6px 12px;
    border-radius: 999px;
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 13px;
  }
  .steps li::before {
    content: counter(step) '. ';
  }
  .steps li.on {
    color: var(--text);
    border-color: var(--text);
  }
  .types {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px;
    max-width: 900px;
  }
  .type {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: 16px 18px;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    text-align: left;
  }
  .type:hover {
    border-color: var(--link);
  }
  .how,
  form,
  .test {
    max-width: 820px;
  }
  .lead {
    color: var(--text-soft);
  }
  .numbered {
    display: grid;
    gap: 14px;
    padding-left: 22px;
  }
  .note {
    font-size: 13px;
    color: var(--text-soft);
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: var(--text-muted);
    max-width: 420px;
  }
  input,
  select {
    font: inherit;
    font-size: 14px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    padding: 7px 10px;
  }
  .row {
    display: flex;
    gap: 8px;
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 16px;
  }
  .actions button,
  .row button,
  .button {
    font-size: 14px;
    padding: 8px 14px;
    border-radius: 10px;
    border: 1px solid var(--border-strong);
    color: var(--text-soft);
    text-decoration: none;
    background: none;
  }
  .primary {
    background: var(--text) !important;
    color: var(--bg) !important;
    border-color: var(--text) !important;
    font-weight: 600;
  }
  .test {
    margin-top: 20px;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .muted {
    color: var(--text-muted);
  }
  .small {
    font-size: 13px;
  }
  .ok {
    color: var(--ok);
  }
  .bad,
  .error {
    color: var(--critical);
  }
  .saved {
    font-weight: 600;
  }
</style>
