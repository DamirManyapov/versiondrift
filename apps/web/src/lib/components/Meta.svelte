<script lang="ts">
  // Title, description, Open Graph and canonical URL for one page (docs/06 "SEO"). Site-wide tags (og:image,
  // og:site_name, twitter:card) live in the root layout.
  import { page } from '$app/state';

  let {
    title,
    description,
    canonical = true,
  }: { title: string; description?: string | undefined; canonical?: boolean } = $props();

  const url = $derived(`${page.url.origin}${page.url.pathname}`);
</script>

<svelte:head>
  <title>{title}</title>
  <meta property="og:title" content={title} />
  {#if description}
    <meta name="description" content={description} />
    <meta property="og:description" content={description} />
  {/if}
  <meta property="og:url" content={url} />
  {#if canonical}<link rel="canonical" href={url} />{/if}
</svelte:head>
