import { readFile } from 'fs/promises'
import { dirname, join, resolve } from 'path'

// Finds the nearest package.json above filePath. Returns { path, data, parent },
// where parent is the next package.json further up (or null), or null when
// there is none. Files that are not valid JSON objects are skipped.
export function findPackageManifest(filePath, { cache, sourceOverrides } = {}) {
  return findFromDirectory(dirname(resolve(filePath)), { cache, sourceOverrides })
}

async function findFromDirectory(dir, { cache, sourceOverrides }) {
  if (cache?.has(dir)) return cache.get(dir)

  const path = join(dir, 'package.json')
  const source = await readManifestSource(path, sourceOverrides)
  const data = parseManifest(source)

  const parentDir = dirname(dir)
  let parent = null
  if (parentDir !== dir) parent = await findFromDirectory(parentDir, { cache, sourceOverrides })

  const manifest = data ? { path, data, parent } : parent

  cache?.set(dir, manifest)
  return manifest
}

async function readManifestSource(path, sourceOverrides) {
  if (sourceOverrides?.has(path)) {
    return String(sourceOverrides.get(path) ?? '')
  }

  try {
    return await readFile(path, 'utf8')
  } catch {
    return undefined
  }
}

function parseManifest(source) {
  if (source === undefined) return null

  try {
    const data = JSON.parse(source)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null
    return data
  } catch {
    return null
  }
}
