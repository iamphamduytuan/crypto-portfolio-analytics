import { NextResponse } from 'next/server'
import { DatasetError, loadSeedDataset } from '@/lib/store/dataset'
import type { ApiErrorResponse, PortfolioResponse } from '@/lib/api-contract'

/**
 * GET /api/portfolio — the supplied dataset, replayed and valued.
 *
 * Stateless: it always reflects the bundled CSVs, so it doubles as the "reset to sample data"
 * operation for the client. User imports go through POST /api/import and are held in client
 * state; see the README for why that boundary was chosen over server-side session storage.
 */
export async function GET() {
  try {
    const dataset = await loadSeedDataset()
    const body: PortfolioResponse = {
      source: dataset.source,
      snapshot: dataset.snapshot,
      trades: dataset.trades,
      prices: dataset.prices,
    }
    return NextResponse.json(body)
  } catch (error) {
    // A failure here means the bundled data or the engine is broken — surface it instead of
    // rendering an empty dashboard that looks like "no trades yet".
    console.error('[api/portfolio] failed to build snapshot', error)
    const body: ApiErrorResponse = {
      error:
        error instanceof DatasetError
          ? error.message
          : 'Could not load the portfolio. The sample data may be missing or corrupt.',
      issues: error instanceof DatasetError ? error.issues : [],
    }
    return NextResponse.json(body, { status: 500 })
  }
}
