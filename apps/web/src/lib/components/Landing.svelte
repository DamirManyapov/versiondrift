<script lang="ts">
  // What VersionDrift is, for first-time visitors (S4-T6). Server-rendered for search engines; visitors with a
  // saved board never see it (app.html marks them before the first paint).
  import { resolve } from '$app/paths';
  import { REPO_URL } from '$lib/config';
  import { i18n } from '$lib/i18n/context';

  const { t } = $derived(i18n());

  const MODES = [
    { title: 'modeAnonymousTitle', text: 'modeAnonymousText', now: true },
    { title: 'modeAccountTitle', text: 'modeAccountText', now: false },
    { title: 'modeSelfHostedTitle', text: 'modeSelfHostedText', now: false },
  ] as const;
</script>

<section class="landing" aria-labelledby="landing-title">
  <div class="hero">
    <h2 id="landing-title">{t('appTagline')}</h2>
    <p class="lead">{t('landingLead')}</p>
    <ul class="points">
      <li>{t('landingPoint1')}</li>
      <li>{t('landingPoint2')}</li>
      <li>{t('landingPoint3')}</li>
    </ul>
    <div class="ctas">
      <a class="btn btn-primary" href={resolve('/catalog')}>{t('landingBuild')}</a>
      <a class="btn" href={REPO_URL} target="_blank" rel="noreferrer">{t('landingGithub')}</a>
    </div>
  </div>

  <div class="modes">
    <h3>{t('landingModesTitle')}</h3>
    <div class="cards">
      {#each MODES as mode (mode.title)}
        <article class="card">
          <div class="head">
            <h4>{t(mode.title)}</h4>
            <span class="badge" class:now={mode.now}>{mode.now ? t('modeNow') : t('modePlanned')}</span>
          </div>
          <p>{t(mode.text)}</p>
        </article>
      {/each}
    </div>
  </div>
  <p class="hint">{t('landingDemoHint')}</p>
</section>

<style>
  :global([data-returning]) .landing {
    display: none;
  }
  .landing {
    display: flex;
    flex-direction: column;
    gap: 28px;
    margin-bottom: 24px;
  }
  .hero {
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-width: 820px;
  }
  h2 {
    margin: 0;
    font-size: 40px;
    line-height: 1.12;
    letter-spacing: -0.02em;
  }
  .lead {
    margin: 0;
    font-size: 18px;
    color: var(--text-soft);
  }
  .points {
    margin: 0;
    padding-left: 20px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    color: var(--text-soft);
  }
  .ctas {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    margin-top: 6px;
  }
  h3 {
    margin: 0 0 12px;
    font-size: 18px;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
  }
  .card {
    padding: 16px 18px;
    border-radius: 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  h4 {
    margin: 0;
    font-size: 16px;
  }
  .card p {
    margin: 0;
    color: var(--text-soft);
    font-size: 14px;
  }
  .badge {
    font-size: 12px;
    padding: 2px 8px;
    border-radius: 6px;
    border: 1px solid var(--border-strong);
    color: var(--text-muted);
    white-space: nowrap;
  }
  .badge.now {
    background: var(--ok-bg);
    border-color: var(--ok-border);
    color: var(--text);
  }
  .hint {
    margin: 0;
    color: var(--text-muted);
    font-size: 14px;
  }
  @media (max-width: 860px) {
    .cards {
      grid-template-columns: minmax(0, 1fr);
    }
    h2 {
      font-size: 30px;
    }
  }
</style>
