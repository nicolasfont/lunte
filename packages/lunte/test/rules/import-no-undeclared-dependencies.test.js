import test from 'brittle'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

import { analyze } from '../../src/core/analyzer.js'
import { builtInRules } from '../../src/rules/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(__dirname, '..', 'fixtures', 'import-no-undeclared-dependencies')

const RULE_ID = 'import/no-undeclared-dependencies'
const BASE_OVERRIDES = Array.from(builtInRules.keys()).map((name) => ({
  name,
  severity: name === RULE_ID ? 'error' : 'off'
}))

function analyzeSnippet(
  source,
  { file = join(FIXTURE, 'index.js'), ruleOverrides = BASE_OVERRIDES, sourceOverrides = [] } = {}
) {
  return analyze({
    files: [file],
    ruleOverrides,
    sourceOverrides: new Map([[file, source], ...sourceOverrides])
  })
}

test('allows dependencies from every dependency field', async (t) => {
  const result = await analyzeSnippet(`
import dep from 'dep'
import sub from 'dep/sub/path.js'
import scoped from '@scope/dep/sub'
const dev = require('dev-dep')
const peer = await import('peer-dep')
const optional = require.resolve('bare-fs')
export { dep, sub, scoped, dev, peer, optional }
`)
  t.is(result.diagnostics.length, 0)
})

test('allows builtins, local paths, URLs and self-references', async (t) => {
  const result = await analyzeSnippet(`
import fsp from 'fs/promises'
import path from 'path'
import test from 'node:test'
import local from './local.js'
import parent from '../parent.js'
import absolute from '/absolute.js'
import data from 'data:text/javascript,export default 1'
import self from '@fixture/self/lib/index.js'
export { fsp, path, test, local, parent, absolute, data, self }
`)
  t.is(result.diagnostics.length, 0)
})

test('flags undeclared imports, requires and re-exports', async (t) => {
  const result = await analyzeSnippet(`
import missing from 'missing'
const scoped = require('@scope/other/sub')
const dynamic = await import('dynamic')
const template = require(\`template\`)
export * from 'reexport-all'
export { named } from 'reexport-named'
export { missing, scoped, dynamic, template }
`)
  t.alike(
    result.diagnostics.map((d) => [d.ruleId, d.line, d.message]),
    [
      [RULE_ID, 2, `'missing' is not declared in package.json dependencies.`],
      [RULE_ID, 3, `'@scope/other' is not declared in package.json dependencies.`],
      [RULE_ID, 4, `'dynamic' is not declared in package.json dependencies.`],
      [RULE_ID, 5, `'template' is not declared in package.json dependencies.`],
      [RULE_ID, 6, `'reexport-all' is not declared in package.json dependencies.`],
      [RULE_ID, 7, `'reexport-named' is not declared in package.json dependencies.`]
    ]
  )
})

test('ignores non-literal specifiers', async (t) => {
  const result = await analyzeSnippet(`
const name = 'missing'
const a = require(name)
const b = await import(name)
const c = await import(\`\${name}/sub\`)
export { a, b, c }
`)
  t.is(result.diagnostics.length, 0)
})

test('ignores type-only imports and checks import-equals requires', async (t) => {
  const result = await analyzeSnippet(
    `
import type { A } from 'types-only'
export type { B } from 'types-only'
import { type D, type E } from 'types-only'
export { type F } from 'types-only'
import { type G, h } from 'mixed-missing'
import fs = require('ts-missing')
export type C = A | B | D | E | G | typeof fs
export { h }
`,
    { file: join(FIXTURE, 'index.ts') }
  )
  t.alike(
    result.diagnostics.map((d) => [d.line, d.message]),
    [
      [6, `'mixed-missing' is not declared in package.json dependencies.`],
      [7, `'ts-missing' is not declared in package.json dependencies.`]
    ]
  )
})

test('resolves specifiers through package.json imports', async (t) => {
  const result = await analyzeSnippet(`
import internal from '#internal'
import lib from '#lib/util'
import pattern from '#pkg/sub'
import fs from 'fs'
import missingTarget from '#missing-target'
import unknown from '#unknown'
import tie from '#tie/util.js'
export { internal, lib, pattern, fs, missingTarget, unknown, tie }
`)
  t.alike(
    result.diagnostics.map((d) => [d.line, d.message]),
    [
      [
        6,
        `'bare-missing' (mapped from '#missing-target') is not declared in package.json dependencies.`
      ],
      [7, `'#unknown' is not mapped in package.json imports.`],
      [
        8,
        `'tie-missing' (mapped from '#tie/util.js') is not declared in package.json dependencies.`
      ]
    ]
  )
})

test('uses dependencies from every package.json above, but imports and name from the nearest', async (t) => {
  const result = await analyzeSnippet(
    `
import nested from 'nested-dep'
import dep from 'dep'
import fs from 'fs'
import self from '@fixture/self'
import internal from '#internal'
export { nested, dep, fs, self, internal }
`,
    { file: join(FIXTURE, 'nested', 'index.js') }
  )
  t.alike(
    result.diagnostics.map((d) => [d.line, d.message]),
    [
      [5, `'@fixture/self' is not declared in package.json dependencies.`],
      [6, `'#internal' is not mapped in package.json imports.`]
    ]
  )
})

test('uses unsaved package.json contents', async (t) => {
  const result = await analyzeSnippet(`import missing from 'missing'\nexport { missing }\n`, {
    sourceOverrides: [[join(FIXTURE, 'package.json'), '{ "dependencies": { "missing": "1" } }']]
  })
  t.is(result.diagnostics.length, 0)
})

test('does nothing without a package.json', async (t) => {
  const result = await analyzeSnippet(`import missing from 'missing'\nexport { missing }\n`, {
    file: '/__lunte_missing__/index.js'
  })
  t.is(result.diagnostics.length, 0)
})

test('does nothing for source without a file path', async (t) => {
  const result = await analyze({
    source: `import missing from 'missing'\nexport { missing }\n`,
    ruleOverrides: BASE_OVERRIDES
  })
  t.is(result.diagnostics.length, 0)
})
