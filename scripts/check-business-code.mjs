import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = new URL('../', import.meta.url)

/** Validate factories and retained SQL without loading production modules or secrets. */
export function inspectBusinessSource(path, source) {
  if (path.endsWith('.vue')) {
    const scripts = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
    let masked = source.replace(/[^\n]/g, ' ')
    for (const script of scripts) {
      const start = script.index + script[0].indexOf('>') + 1
      masked = masked.slice(0, start) + script[1] + masked.slice(start + script[1].length)
    }
    source = masked
  }
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
  const issues = []
  const definitions = []
  const internalDefinitions = []
  const constructors = new Set(['Error', 'ApiError', 'AppSdkError', 'ApplicationError', 'CalculationError', 'DateTimeError', 'RequestError'])
  function report(node, message) {
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1
    issues.push(`${path}:${line}: ${message}`)
  }
  function responseFactory(node) {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isMethodDeclaration(parent) && parent.name.getText(file) === 'fromResponse') {
        return true
      }
    }
    return false
  }
  const factory = /(?:^|\/)(?:error-codes|sdk-error|factories)\.ts$/.test(path)
  const initialization = /(?:^|\/)(?:api\/src\/(?:db\/(?:initialize|schema\/.*)|init-db)|apps\/[^/]+\/server\/src\/schema)\.ts$/.test(path)
  function sqlBranches(value) {
    if (ts.isConditionalExpression(value)) {
      return [...sqlBranches(value.whenTrue), ...sqlBranches(value.whenFalse)]
    }
    if (ts.isParenthesizedExpression(value) || ts.isAsExpression(value)) {
      return sqlBranches(value.expression)
    }
    return ts.isStringLiteralLike(value) ? [value.text] : ts.isTemplateExpression(value) ? [value.getText(file).slice(1, -1)] : []
  }
  function wildcardProjection(value) {
    // COUNT(*) and multiplication are expressions, not implicit row projections.
    return /(?:^|,)\s*(?:[a-z_]\w*\.)?\*\s*(?=,|$)/i.test(value)
  }
  function visit(node) {
    if (!initialization && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      ['select', 'addSelect'].includes(node.expression.name.text)) {
      for (const value of node.arguments) {
        const projections = ts.isArrayLiteralExpression(value) ? [...value.elements].flatMap(sqlBranches) : sqlBranches(value)
        if (projections.some(wildcardProjection)) {
          report(node, 'Choose explicit query fields; wildcard row projections are not allowed.')
        }
      }
    }
    if (ts.isNewExpression(node) && constructors.has(node.expression.getText(file)) && !factory && !responseFactory(node)) {
      report(node, 'Create business errors through a typed error factory; constructors belong to catalogs/transport adapters.')
    }
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'defineApiErrors') {
      const object = node.arguments[0]
      if (!object || !ts.isObjectLiteralExpression(object)) {
        report(node, 'Error catalogs must use explicit static definitions.')
      } else {
        for (const property of object.properties) {
          if (!ts.isPropertyAssignment(property)) {
            report(property, 'Register codes explicitly; compose existing factories outside the definition.')
            continue
          }
          const code = ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) ? property.name.text : ''
          if (!/^[A-Z][A-Z0-9_]{2,79}$/.test(code)) {
            report(property, 'Error codes must be stable uppercase identifiers.')
          }
          definitions.push({ code, path })
          function validateStatus(value) {
            if (ts.isPropertyAssignment(value) && value.name.getText(file).replaceAll(/['"]/g, '') === 'statusCode') {
              if (!ts.isNumericLiteral(value.initializer) || Number(value.initializer.text) < 400 || Number(value.initializer.text) > 599) {
                report(value, 'An API error needs a literal HTTP error status between 400 and 599.')
              }
            }
            ts.forEachChild(value, validateStatus)
          }
          validateStatus(property.initializer)
        }
      }
    }
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'defineInternalErrors') {
      const [namespace, object] = node.arguments
      if (!namespace || !ts.isStringLiteral(namespace) || !/^[A-Z][A-Z0-9_]+$/.test(namespace.text) || !object || !ts.isObjectLiteralExpression(object)) {
        report(node, 'Internal error catalogs need a static namespace and explicit definitions.')
      } else {
        for (const property of object.properties) {
          if (!ts.isPropertyAssignment(property)) {
            report(property, 'Register internal codes explicitly.')
            continue
          }
          const code = `${namespace.text}_${property.name.getText(file).replaceAll(/['"]/g, '')}`
          if (!/^[A-Z][A-Z0-9_]{2,79}$/.test(code)) {
            report(property, 'Namespaced internal codes must fit the 80-character diagnostic identifier limit.')
          }
          internalDefinitions.push({ code, path })
        }
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      ['select', 'addSelect'].includes(node.expression.name.text) && node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]) && /^\w+\.\w+$/.test(node.arguments[0].text)) {
      let outer = node
      while (outer.parent && (ts.isCallExpression(outer.parent) || ts.isPropertyAccessExpression(outer.parent))) {
        outer = outer.parent
      }
      if (/\.getRaw(?:Many|One)/.test(outer.getText(file))) {
        report(node, 'Name the raw result alias explicitly; TypeORM otherwise prefixes hydrated column selections.')
      }
    }
    if (!initialization && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      ['query', 'rows', 'execute'].includes(node.expression.name.text) && node.arguments[0]) {
      for (const sql of sqlBranches(node.arguments[0]).filter((sql) => /^\s*(?:SELECT|INSERT|UPDATE|DELETE)\b/i.test(sql))) {
        if ([...sql.matchAll(/\bSELECT\b([\s\S]+?)\bFROM\b/gi)].some((match) => wildcardProjection(match[1].trim()))) {
          report(node, 'Choose explicit query fields; wildcard row projections are not allowed.')
        }
        const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line
        let statement = node
        while (statement.parent && !ts.isStatement(statement)) {
          statement = statement.parent
        }
        const before = source.slice(Math.min(statement.getFullStart(), file.getPositionOfLineAndCharacter(Math.max(0, line - 2), 0)), node.getStart(file))
        if (!/\/\/ native-sql: .+/.test(before)) {
          report(node, 'Use Repository/QueryBuilder for normal CRUD; retained native SQL requires a specific native-sql justification.')
        }
        const complex = /GET_LOCK|RELEASE_LOCK|GROUP BY|HAVING|UNION|JSON_EXTRACT|ON DUPLICATE KEY|\bSELECT[\s\S]+\bSELECT\b|^\s*(?:INSERT|UPDATE)\b[\s\S]+\bSELECT\b|\bDELETE\s+\w+\s+FROM/i.test(sql) || /^\s*SELECT\s+1\s*$/i.test(sql)
        if (!complex) {
          report(node, 'This is ordinary CRUD; a native-sql comment cannot replace converting it to the ORM.')
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return { issues, definitions, internalDefinitions }
}

export async function checkBusinessCode() {
  const issues = []
  const codes = new Map()
  let publicCodes = 0
  let count = 0
  async function walk(directory) {
    for (const entry of await readdir(new URL(directory, root), { withFileTypes: true })) {
      if (['node_modules', 'dist', 'test', 'ios', 'android'].includes(entry.name)) {
        continue
      }
      const path = `${directory}/${entry.name}`
      if (entry.isDirectory()) {
        await walk(path)
      } else if (path.includes('/src/') && /\.(?:ts|vue)$/.test(path)) {
        count++
        const result = inspectBusinessSource(path, await readFile(new URL(path, root), 'utf8'))
        issues.push(...result.issues)
        publicCodes += result.definitions.length
        for (const definition of [...result.definitions, ...result.internalDefinitions]) {
          if (codes.has(definition.code)) {
            issues.push(`${path}: duplicate error code ${definition.code}, already owned by ${codes.get(definition.code)}`)
          }
          codes.set(definition.code, path)
        }
      }
    }
  }
  for (const directory of ['api/src', 'app/src', 'admin/src', 'shared/src', 'apps', 'packages', 'capacitor-plugins']) {
    await walk(directory)
  }
  return { issues, count, codes: publicCodes, internalCodes: codes.size - publicCodes }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await checkBusinessCode()
  if (result.issues.length) {
    console.error(result.issues.join('\n'))
    process.exitCode = 1
  } else {
    console.log(`Business code verified: ${result.count} sources, ${result.codes} API and ${result.internalCodes} internal error definitions.`)
  }
}
