<script lang="ts">
  // Settings, self-hosted: notification channels (docs/07 "Notifications"). Credentials are write-only here.
  import { onMount } from 'svelte';
  import { formatDate } from '$lib/format';
  import type { MessageKey } from '$lib/i18n';
  import { i18n } from '$lib/i18n/context';
  import type { PublicChannel } from '$lib/server/channels';

  type Kind = PublicChannel['kind'];
  type Field = { key: string; type: 'text' | 'password' | 'number' | 'checkbox'; required?: boolean };

  const { t, locale } = $derived(i18n());

  const KINDS: Kind[] = ['telegram', 'ntfy', 'gotify', 'webhook', 'email'];
  const EVENTS = ['critical', 'eol', 'update', 'digest'] as const;
  const FIELDS: Record<Kind, Field[]> = {
    telegram: [
      { key: 'token', type: 'password', required: true },
      { key: 'chatId', type: 'text', required: true },
    ],
    ntfy: [
      { key: 'server', type: 'text' },
      { key: 'topic', type: 'text', required: true },
      { key: 'token', type: 'password' },
    ],
    gotify: [
      { key: 'server', type: 'text', required: true },
      { key: 'token', type: 'password', required: true },
    ],
    webhook: [
      { key: 'url', type: 'text', required: true },
      { key: 'secret', type: 'password' },
    ],
    email: [
      { key: 'host', type: 'text', required: true },
      { key: 'port', type: 'number', required: true },
      { key: 'secure', type: 'checkbox' },
      { key: 'user', type: 'text' },
      { key: 'password', type: 'password' },
      { key: 'from', type: 'text', required: true },
      { key: 'to', type: 'text', required: true },
    ],
  };

  let channels = $state<PublicChannel[]>([]);
  let editing = $state<number | 'new' | undefined>();
  let confirming = $state<number | undefined>();
  let problem = $state('');
  let notice = $state('');
  interface FormState {
    name: string;
    kind: Kind;
    config: Record<string, string | number | boolean>;
    secrets: string[];
    events: string[];
    lang: 'en' | 'ru';
    digestDay: number | null;
    enabled: boolean;
  }
  let form = $state<FormState>({
    name: '',
    kind: 'telegram',
    config: {},
    secrets: [],
    events: ['critical', 'eol', 'update', 'digest'],
    lang: 'en',
    digestDay: 1,
    enabled: true,
  });

  // Monday first, in the viewer's language.
  const days = $derived(
    [1, 2, 3, 4, 5, 6, 0].map((day) => ({
      day,
      name: new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(
        new Date(Date.UTC(2026, 8, 20 + day)),
      ),
    })),
  );

  async function call(path: string, init?: RequestInit): Promise<Response> {
    const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json' } });
    if (!response.ok) {
      const text = await response.text();
      let message = text;
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? text;
      } catch {
        // plain text
      }
      throw new Error(message || `HTTP ${response.status}`);
    }
    return response;
  }

  async function run(action: () => Promise<void>) {
    try {
      problem = '';
      notice = '';
      await action();
    } catch (error) {
      problem = (error as Error).message;
    }
  }

  const load = () =>
    run(async () => {
      channels = ((await (await call('/api/channels')).json()) as { channels: PublicChannel[] }).channels;
    });

  onMount(() => void load());

  function start(channel?: PublicChannel) {
    editing = channel?.id ?? 'new';
    form = channel
      ? {
          name: channel.name,
          kind: channel.kind,
          config: { ...(channel.config as Record<string, string | number | boolean>) },
          secrets: channel.secrets,
          events: [...channel.events],
          lang: channel.lang,
          digestDay: channel.digestDay ?? 1,
          enabled: channel.enabled,
        }
      : { ...form, name: '', config: { port: 587, secure: false }, secrets: [], enabled: true };
  }

  function save(event: SubmitEvent) {
    event.preventDefault();
    void run(async () => {
      const payload = {
        name: form.name,
        events: form.events,
        lang: form.lang,
        digestDay: form.events.includes('digest') ? form.digestDay : null,
        enabled: form.enabled,
        config: form.config,
        ...(editing === 'new' && { kind: form.kind }),
      };
      await call(editing === 'new' ? '/api/channels' : `/api/channels/${editing}`, {
        method: editing === 'new' ? 'POST' : 'PATCH',
        body: JSON.stringify(payload),
      });
      editing = undefined;
      await load();
    });
  }

  const test = (id: number) =>
    run(async () => {
      await call(`/api/channels/${id}/test`, { method: 'POST' });
      notice = t('testSent');
    });

  const toggle = (channel: PublicChannel) =>
    run(async () => {
      await call(`/api/channels/${channel.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !channel.enabled }),
      });
      await load();
    });

  const checkNow = () =>
    run(async () => {
      await call('/api/alerts/run', { method: 'POST' });
      await load();
    });

  const remove = (id: number) =>
    run(async () => {
      await call(`/api/channels/${id}`, { method: 'DELETE' });
      confirming = undefined;
      await load();
    });

  const label = (kind: Kind, key: string) => t(`field_${kind}_${key}` as MessageKey);
  const textOf = (value: string | number | boolean | undefined) =>
    typeof value === 'boolean' || value === undefined ? '' : value;
</script>

<section>
  <h2>{t('notificationsTitle')}</h2>
  <p class="muted">{t('notificationsHint')}</p>

  {#if channels.length > 0}
    <ul class="channels">
      {#each channels as channel (channel.id)}
        <li class:off={!channel.enabled}>
          <div class="info">
            <strong>{channel.name}</strong>
            <span class="muted">
              {t(`kind_${channel.kind}` as MessageKey)} ·
              {channel.lastSentAt
                ? t('lastSent', { date: formatDate(channel.lastSentAt, locale) })
                : t('neverSent')}
            </span>
            {#if channel.lastError}<span class="error"
                >{t('lastErrorLabel', { message: channel.lastError })}</span
              >{/if}
          </div>
          <div class="actions">
            <button class="btn btn-sm" onclick={() => void test(channel.id)}>{t('sendTest')}</button>
            <button class="btn btn-sm" onclick={() => start(channel)}>{t('edit')}</button>
            <button class="btn btn-sm" onclick={() => void toggle(channel)}
              >{channel.enabled ? t('disable') : t('enable')}</button
            >
            {#if confirming === channel.id}
              <button class="btn btn-sm btn-danger" onclick={() => void remove(channel.id)}
                >{t('deleteChannelConfirm', { name: channel.name })}</button
              >
              <button class="btn btn-sm" onclick={() => (confirming = undefined)}>{t('cancel')}</button>
            {:else}
              <button class="btn btn-sm btn-danger-ghost" onclick={() => (confirming = channel.id)}
                >{t('deleteChannel')}</button
              >
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  {#if problem}<p class="error" role="alert">{problem}</p>{/if}
  {#if notice}<p class="ok" role="status">{notice}</p>{/if}

  {#if editing === undefined}
    <div class="actions">
      <button class="btn btn-primary" onclick={() => start()}>{t('addChannel')}</button>
      {#if channels.some((c) => c.enabled)}<button class="btn" onclick={() => void checkNow()}
          >{t('checkNow')}</button
        >{/if}
    </div>
  {:else}
    <form onsubmit={save}>
      <div class="row">
        <label>
          <span>{t('channelName')}</span>
          <input bind:value={form.name} maxlength="60" required />
        </label>
        <label>
          <span>{t('channelKind')}</span>
          <select class="input" bind:value={form.kind} disabled={editing !== 'new'}>
            {#each KINDS as kind (kind)}<option value={kind}>{t(`kind_${kind}` as MessageKey)}</option>{/each}
          </select>
        </label>
      </div>

      {#each FIELDS[form.kind] as field (field.key)}
        {#if field.type === 'checkbox'}
          <label class="check">
            <input
              type="checkbox"
              bind:checked={
                () => form.config[field.key] === true, (v: boolean) => (form.config[field.key] = v)
              }
            />
            {label(form.kind, field.key)}
          </label>
        {:else}
          <label>
            <span>{label(form.kind, field.key)}</span>
            <input
              type={field.type}
              autocomplete="off"
              required={field.required && !(field.type === 'password' && form.secrets.includes(field.key))}
              placeholder={field.type === 'password' && form.secrets.includes(field.key)
                ? t('secretKept')
                : ''}
              bind:value={
                () => textOf(form.config[field.key]), (v: string | number) => (form.config[field.key] = v)
              }
            />
          </label>
        {/if}
      {/each}

      <fieldset>
        <legend>{t('eventsLabel')}</legend>
        {#each EVENTS as event (event)}
          <label class="check">
            <input type="checkbox" value={event} bind:group={form.events} />
            {t(`event_${event}` as MessageKey)}
          </label>
        {/each}
      </fieldset>

      <div class="row">
        {#if form.events.includes('digest')}
          <label>
            <span>{t('digestDayLabel')}</span>
            <select class="input" bind:value={form.digestDay}>
              {#each days as { day, name } (day)}<option value={day}>{name}</option>{/each}
            </select>
          </label>
        {/if}
        <label>
          <span>{t('channelLanguage')}</span>
          <select class="input" bind:value={form.lang}>
            <option value="en">English</option>
            <option value="ru">Русский</option>
          </select>
        </label>
        <label class="check">
          <input type="checkbox" bind:checked={form.enabled} />
          {t('channelEnabled')}
        </label>
      </div>

      <div class="actions">
        <button class="btn btn-primary" type="submit">{t('save')}</button>
        <button class="btn" type="button" onclick={() => (editing = undefined)}>{t('cancel')}</button>
      </div>
    </form>
  {/if}
</section>

<style>
  .channels {
    list-style: none;
    margin: 0 0 12px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .channels li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 12px 14px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--surface);
  }
  .channels li.off {
    opacity: 0.7;
  }
  .info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    border-radius: 12px;
    border: 1px solid var(--border-strong);
    background: var(--surface);
  }
  .row {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    align-items: flex-end;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 14px;
  }
  label.check {
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }
  fieldset {
    border: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  legend {
    font-size: 14px;
    margin-bottom: 6px;
  }
  input:not([type='checkbox']) {
    height: var(--control-h);
    font: inherit;
    font-size: 14px;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--border-strong);
    border-radius: var(--control-radius-sm);
    padding: 0 12px;
    min-width: 220px;
    transition: border-color 0.12s;
  }
  select {
    min-width: 220px;
  }
  input:not([type='checkbox']):hover:not(:disabled, :focus) {
    border-color: var(--text-muted);
  }
  .muted {
    color: var(--text-muted);
    font-size: 13px;
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
