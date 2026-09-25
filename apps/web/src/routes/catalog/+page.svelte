<script lang="ts">
  import { i18n } from '$lib/i18n/context';

  const { t } = $derived(i18n());
</script>

<h1>{t('navCatalog')}</h1>
<p>{t('loading')}</p>
