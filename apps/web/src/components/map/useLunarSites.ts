import { useEffect, useState } from 'react';
import type { LunarSite, SiteIndexEntry } from './lunarTypes';

interface LunarSitesResult {
  sites: LunarSite[];
  selectedSite: LunarSite | null;
  loading: boolean;
  error: string | null;
}

/** Loads the curated catalogue and its per-site JSON products from Vite public/. */
export function useLunarSites(selectedSiteId = 'shackleton_rim_01'): LunarSitesResult {
  const [sites, setSites] = useState<LunarSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function loadSites() {
      setLoading(true);
      setError(null);
      try {
        // Fetch the requested hero site explicitly; it is the live horizon source
        // used by the skyline chart and the default map selection.
        const heroResponse = await fetch('/data/sites/shackleton_rim_01.json', {
          signal: controller.signal,
        });
        if (!heroResponse.ok) throw new Error(`Shackleton data: HTTP ${heroResponse.status}`);
        const heroSite = (await heroResponse.json()) as LunarSite;
        if (active) setSites([heroSite]);

        const indexResponse = await fetch('/data/sites/index.json', { signal: controller.signal });
        if (!indexResponse.ok) throw new Error(`Site catalogue: HTTP ${indexResponse.status}`);
        const index = (await indexResponse.json()) as SiteIndexEntry[];

        const detailResults = await Promise.allSettled(
          index
            .filter((entry) => entry.siteId !== heroSite.siteId)
            .map(async (entry) => {
              const response = await fetch(`/data/sites/${entry.siteId}.json`, {
                signal: controller.signal,
              });
              if (!response.ok) throw new Error(`${entry.siteId}: HTTP ${response.status}`);
              return (await response.json()) as LunarSite;
            }),
        );
        const details = detailResults.flatMap((result) =>
          result.status === 'fulfilled' ? [result.value] : [],
        );
        if (active) setSites([heroSite, ...details]);
      } catch (cause) {
        if (active && !(cause instanceof DOMException && cause.name === 'AbortError')) {
          setError(cause instanceof Error ? cause.message : 'Unable to load lunar site data.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadSites();
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  return {
    sites,
    selectedSite: sites.find((site) => site.siteId === selectedSiteId) ?? sites[0] ?? null,
    loading,
    error,
  };
}
