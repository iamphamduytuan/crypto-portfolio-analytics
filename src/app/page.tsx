import { Dashboard } from '@/components/Dashboard'
import type { PortfolioResponse } from '@/lib/api-contract'
import { DatasetError, loadSeedDataset } from '@/lib/store/dataset'

/**
 * Server component entry point.
 *
 * The seed snapshot is computed on the server and handed to the client shell as props, so the
 * first paint already shows real figures — no loading spinner on initial visit, and no client
 * round-trip for data that is known at request time. The client takes over for imports.
 *
 * `force-dynamic` keeps the page out of the static cache: it reads the CSVs from the filesystem at
 * request time, and a statically prerendered build would freeze the snapshot at build time.
 */
export const dynamic = 'force-dynamic'

export default async function HomePage() {
  let initialData: PortfolioResponse | null = null
  let initialError: string | null = null

  try {
    const dataset = await loadSeedDataset()
    initialData = {
      source: dataset.source,
      snapshot: dataset.snapshot,
      trades: dataset.trades,
      prices: dataset.prices,
    }
  } catch (error) {
    console.error('[page] failed to load seed dataset', error)
    initialError =
      error instanceof DatasetError
        ? error.message
        : 'Could not load the sample portfolio data on the server.'
  }

  return (
    <main className="flex-1">
      <Dashboard initialData={initialData} initialError={initialError} />
    </main>
  )
}
