/**
 * Minimal RFC-4180 CSV reader.
 *
 * Hand-rolled rather than pulling in a parser dependency: the input contract is narrow (a header
 * row plus flat numeric/string columns, no embedded newlines in the supplied files) and this
 * keeps the import boundary auditable, which matters because the import is the part of the system
 * that must reject bad data. Quoted fields and escaped quotes are still handled so a
 * spreadsheet-exported re-import does not break.
 */

export type CsvRow = Record<string, string>

export type CsvParseResult = {
  headers: string[]
  rows: CsvRow[]
  /** 1-based line number in the source file for each row, used in validation messages. */
  lineNumbers: number[]
}

export class CsvFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CsvFormatError'
  }
}

/** Split one CSV line into fields, honouring quoted sections and `""` escapes. */
function splitLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += char
      }
      continue
    }

    if (char === '"') inQuotes = true
    else if (char === ',') {
      fields.push(current)
      current = ''
    } else current += char
  }

  fields.push(current)
  return fields
}

export function parseCsv(text: string): CsvParseResult {
  // Strip a UTF-8 BOM — Excel adds one and it would corrupt the first header name.
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')

  let headerIndex = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '') {
      headerIndex = i
      break
    }
  }
  if (headerIndex === -1) throw new CsvFormatError('File is empty — expected a header row.')

  const headers = splitLine(lines[headerIndex]).map((h) => h.trim())
  const rows: CsvRow[] = []
  const lineNumbers: number[] = []

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') continue

    const fields = splitLine(line)
    if (fields.length !== headers.length) {
      throw new CsvFormatError(
        `Line ${i + 1}: expected ${headers.length} columns but found ${fields.length}.`
      )
    }

    const row: CsvRow = {}
    headers.forEach((header, index) => {
      row[header] = fields[index].trim()
    })
    rows.push(row)
    lineNumbers.push(i + 1)
  }

  return { headers, rows, lineNumbers }
}
