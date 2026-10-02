import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // The seed CSVs are read with `node:fs` at request time (see src/lib/store/dataset.ts). Next's
  // bundler cannot infer that from a runtime-constructed path, so they are declared explicitly or
  // the deployed function would 500 with ENOENT while working fine locally.
  outputFileTracingIncludes: {
    '/': ['./data/*.csv'],
    '/api/**/*': ['./data/*.csv'],
  },
}

export default nextConfig
