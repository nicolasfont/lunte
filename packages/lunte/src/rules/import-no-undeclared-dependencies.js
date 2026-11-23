import { Severity } from '../core/constants.js'

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies'
]

const NODE_BUILTINS = new Set([
  'assert',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'domain',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'sys',
  'timers',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib'
])

const URL_SCHEME = /^[a-zA-Z][a-zA-Z\d+.-]*:/

export const importNoUndeclaredDependencies = {
  meta: {
    name: 'import/no-undeclared-dependencies',
    description: 'Disallow importing or requiring packages not declared in package.json.',
    recommended: true,
    defaultSeverity: Severity.error,
    defaultOptions: [{ allow: [] }]
  },
  create(context) {
    const manifest = context.getPackageManifest()
    if (!manifest) return {}

    const { data } = manifest
    const declared = collectDeclaredDependencies(manifest)
    const { allow } = context.options[0] ?? {}
    const allowed = new Set(Array.isArray(allow) ? allow : [])
    const imports = data.imports && typeof data.imports === 'object' ? data.imports : null

    function check(node) {
      const specifier = getStringValue(node)
      if (specifier === undefined || isLocalSpecifier(specifier)) return

      const mapping = imports ? matchImport(imports, specifier) : null
      if (mapping) {
        for (const target of mapping.targets) {
          if (!isLocalSpecifier(target) && !target.startsWith('#') && !isDeclared(target)) {
            context.report({
              node,
              message: `'${getPackageName(target)}' (mapped from '${specifier}') is not declared in package.json dependencies.`
            })
          }
        }

        return
      }

      if (specifier.startsWith('#')) {
        context.report({
          node,
          message: `'${specifier}' is not mapped in package.json imports.`
        })
        return
      }

      if (!isDeclared(specifier)) {
        context.report({
          node,
          message: `'${getPackageName(specifier)}' is not declared in package.json dependencies.`
        })
      }
    }

    function isDeclared(specifier) {
      const name = getPackageName(specifier)
      return (
        NODE_BUILTINS.has(name) || name === data.name || declared.has(name) || allowed.has(name)
      )
    }

    return {
      ImportDeclaration(node) {
        const typeSpecifiers =
          node.specifiers.length > 0 &&
          node.specifiers.every((specifier) => specifier.importKind === 'type')
        if (node.importKind === 'type' || typeSpecifiers) return
        check(node.source)
      },
      ExportNamedDeclaration(node) {
        const typeSpecifiers =
          node.specifiers.length > 0 &&
          node.specifiers.every((specifier) => specifier.exportKind === 'type')
        if (!node.source || node.exportKind === 'type' || typeSpecifiers) return
        check(node.source)
      },
      ExportAllDeclaration(node) {
        if (node.exportKind === 'type') return
        check(node.source)
      },
      ImportExpression(node) {
        check(node.source)
      },
      CallExpression(node) {
        if (isRequireCall(node.callee) && node.arguments.length > 0) {
          check(node.arguments[0])
        }
      },
      TSImportEqualsDeclaration(node) {
        if (node.importKind === 'type') return
        if (node.moduleReference?.type !== 'TSExternalModuleReference') return
        check(node.moduleReference.expression)
      }
    }
  }
}

// Dependencies declared by the nearest package.json or any package.json above
// it, since packages installed further up are still resolvable.
function collectDeclaredDependencies(manifest) {
  const declared = new Set()

  for (let current = manifest; current; current = current.parent) {
    for (const field of DEPENDENCY_FIELDS) {
      const dependencies = current.data[field]
      if (!dependencies || typeof dependencies !== 'object') continue
      for (const name of Object.keys(dependencies)) {
        declared.add(name)
      }
    }
  }

  return declared
}

// Resolves a specifier against package.json "imports" the way Node and Bare do:
// an exact key wins, otherwise the single-"*" pattern with the longest prefix.
function matchImport(imports, specifier) {
  if (!specifier.includes('*') && Object.hasOwn(imports, specifier)) {
    return { targets: collectTargets(imports[specifier]) }
  }

  let best = null

  for (const key of Object.keys(imports)) {
    const star = key.indexOf('*')
    if (star === -1 || key.indexOf('*', star + 1) !== -1) continue

    const prefix = key.slice(0, star)
    const suffix = key.slice(star + 1)
    const matches =
      specifier.length >= key.length && specifier.startsWith(prefix) && specifier.endsWith(suffix)
    if (!matches) continue

    const longerPrefix = !best || prefix.length > best.prefix.length
    const longerKey = prefix.length === best?.prefix.length && key.length > best.key.length
    if (!longerPrefix && !longerKey) continue

    best = {
      key,
      prefix,
      match: specifier.slice(prefix.length, specifier.length - suffix.length)
    }
  }

  if (!best) return null

  const targets = collectTargets(imports[best.key]).map((target) =>
    target.replaceAll('*', best.match)
  )
  return { targets }
}

// Collects every target reachable through conditions and fallback arrays.
function collectTargets(value) {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(collectTargets)
  if (value && typeof value === 'object') return Object.values(value).flatMap(collectTargets)
  return []
}

function getStringValue(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') {
    return node.value
  }
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0].value.cooked
  }
  return undefined
}

function isRequireCall(callee) {
  if (callee.type === 'Identifier') return callee.name === 'require'
  return (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'require' &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 'resolve'
  )
}

function isLocalSpecifier(specifier) {
  return (
    specifier === '' ||
    specifier === '.' ||
    specifier === '..' ||
    specifier.startsWith('./') ||
    specifier.startsWith('../') ||
    specifier.startsWith('/') ||
    URL_SCHEME.test(specifier)
  )
}

function getPackageName(specifier) {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}
