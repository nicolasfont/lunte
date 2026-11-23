import test from 'brittle'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

import { analyze } from '../src/core/analyzer.js'
import { findPackageManifest } from '../src/core/package-manifest.js'
import { builtInRules, registerRule } from '../src/rules/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(__dirname, 'fixtures', 'package-manifest')

test('finds package.json in the file directory', async (t) => {
  const manifest = await findPackageManifest(join(FIXTURES, 'index.js'))
  t.is(manifest.path, join(FIXTURES, 'package.json'))
  t.is(manifest.data.name, 'manifest-root')
})

test('walks up to the nearest package.json', async (t) => {
  const manifest = await findPackageManifest(join(FIXTURES, 'nested', 'src', 'deep', 'index.js'))
  t.is(manifest.data.name, 'manifest-nested')
})

test('links each package.json to the one above it', async (t) => {
  const manifest = await findPackageManifest(join(FIXTURES, 'nested', 'index.js'))
  t.is(manifest.parent.path, join(FIXTURES, 'package.json'))
  t.is(manifest.parent.data.name, 'manifest-root')
})

test('skips package.json files that are not valid JSON', async (t) => {
  const manifest = await findPackageManifest(join(FIXTURES, 'invalid', 'index.js'))
  t.is(manifest.data.name, 'manifest-root')
})

test('returns null when no package.json exists', async (t) => {
  const manifest = await findPackageManifest('/__lunte_missing__/src/index.js')
  t.is(manifest, null)
})

test('prefers source overrides over disk', async (t) => {
  const path = join(FIXTURES, 'package.json')
  const sourceOverrides = new Map([[path, '{ "name": "unsaved" }']])
  const manifest = await findPackageManifest(join(FIXTURES, 'index.js'), { sourceOverrides })
  t.is(manifest.data.name, 'unsaved')
})

test('caches the result for every visited directory', async (t) => {
  const cache = new Map()
  const manifest = await findPackageManifest(join(FIXTURES, 'nested', 'src', 'index.js'), {
    cache
  })
  t.is(cache.get(join(FIXTURES, 'nested', 'src')), manifest)
  t.is(cache.get(join(FIXTURES, 'nested')), manifest)

  const sourceOverrides = new Map([[join(FIXTURES, 'nested', 'package.json'), '{}']])
  const cached = await findPackageManifest(join(FIXTURES, 'nested', 'src', 'other.js'), {
    cache,
    sourceOverrides
  })
  t.is(cached, manifest)
})

test('exposes the package manifest to rules', async (t) => {
  const name = 'test/package-manifest'
  const seen = []
  registerRule({
    meta: { name },
    create(context) {
      seen.push(context.getPackageManifest())
      return {}
    }
  })
  t.teardown(() => {
    builtInRules.delete(name)
  })

  const ruleOverrides = Array.from(builtInRules.keys()).map((rule) => ({
    name: rule,
    severity: rule === name ? 'error' : 'off'
  }))

  await analyze({
    files: [join(FIXTURES, 'nested', 'index.js')],
    ruleOverrides,
    sourceOverrides: new Map([[join(FIXTURES, 'nested', 'index.js'), '']])
  })
  await analyze({ source: '', ruleOverrides })

  t.is(seen.length, 2)
  t.is(seen[0].data.name, 'manifest-nested')
  t.is(seen[1], null)
})
