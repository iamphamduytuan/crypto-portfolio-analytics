import { NextResponse } from 'next/server'
import { DatasetError, importUploadedCsv } from '@/lib/store/dataset'
import { parsePriceSnapshotValue, parseTradeList } from '@/lib/csv/validate'
import type { PriceSnapshot, Trade } from '@/lib/domain/types'
import type { ApiErrorResponse, PortfolioResponse } from '@/lib/api-contract'
import type { ValidationIssue } from '@/lib/csv/validate'

/**
 * POST /api/import — validate an uploaded `trades.csv` or `prices.csv` and return a full snapshot.
 *
 * Accepts `multipart/form-data` with a `file` field. Optional `trades` and `prices` JSON fields
 * carry the dataset currently on screen, so uploading one supplied file does not discard the other.
 *
 * The response is the complete new dataset. The client swaps state only on 200, so a 422 leaves
 * the previous dataset untouched.
 */

/** Guard against a memory-exhaustion upload; the supplied files are a few dozen kilobytes. */
const MAX_BYTES = 5 * 1024 * 1024

export async function POST(request: Request) {
  let csvText: string
  let contextTrades: Trade[] | undefined
  let contextPrices: PriceSnapshot | undefined

  try {
    const contentType = request.headers.get('content-type') ?? ''

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file')
      if (!(file instanceof File)) {
        return badRequest('No file was provided. Attach the CSV as the "file" field.')
      }
      if (file.size > MAX_BYTES) {
        return badRequest(`File is too large (limit ${MAX_BYTES / 1024 / 1024} MB).`)
      }
      csvText = await file.text()

      const tradesField = readJsonField(formData.get('trades'))
      if (tradesField !== undefined) {
        const parsed = parseTradeList(tradesField)
        if (!parsed.ok) return unprocessable('The current trade history could not be revalued.', parsed.issues)
        contextTrades = parsed.data
      }

      const pricesField = readJsonField(formData.get('prices'))
      if (pricesField !== undefined) {
        const parsed = parsePriceSnapshotValue(pricesField)
        if (!parsed.ok) return unprocessable('The current price snapshot could not be reused.', parsed.issues)
        contextPrices = parsed.data
      }
    } else {
      csvText = await request.text()
      if (csvText.length > MAX_BYTES) {
        return badRequest(`File is too large (limit ${MAX_BYTES / 1024 / 1024} MB).`)
      }
    }
  } catch (error) {
    console.error('[api/import] could not read request body', error)
    const message = error instanceof Error ? error.message : 'Could not read the uploaded file.'
    return badRequest(message)
  }

  if (csvText.trim() === '') {
    return badRequest('The uploaded file is empty.')
  }

  try {
    const { dataset, accepted } = await importUploadedCsv(csvText, {
      trades: contextTrades,
      prices: contextPrices,
    })
    const body: PortfolioResponse = {
      source: dataset.source,
      snapshot: dataset.snapshot,
      trades: dataset.trades,
      prices: dataset.prices,
      accepted,
    }
    return NextResponse.json(body)
  } catch (error) {
    if (error instanceof DatasetError) {
      const body: ApiErrorResponse = { error: error.message, issues: error.issues }
      return NextResponse.json(body, { status: 422 })
    }

    console.error('[api/import] unexpected failure while replaying trades', error)
    const body: ApiErrorResponse = {
      error: 'The file passed validation but could not be processed. Please report this.',
      issues: [],
    }
    return NextResponse.json(body, { status: 500 })
  }
}

function readJsonField(value: FormDataEntryValue | null): unknown {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  try {
    return JSON.parse(value) as unknown
  } catch {
    throw new Error('A context field on the upload was not valid JSON.')
  }
}

function badRequest(message: string) {
  const body: ApiErrorResponse = { error: message, issues: [] }
  return NextResponse.json(body, { status: 400 })
}

function unprocessable(message: string, issues: ValidationIssue[]) {
  const body: ApiErrorResponse = { error: message, issues }
  return NextResponse.json(body, { status: 422 })
}
