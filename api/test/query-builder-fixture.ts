import { DataSource, QueryResult } from 'typeorm'
import { entities } from '../src/db/entities.js'

class FixtureDataSource extends DataSource {
  prepareMetadata() {
    return this.buildMetadatas()
  }
}

/** Real TypeORM SQL generation with an in-memory driver boundary; never connects. */
export async function queryBuilderFixture(query: (sql: string, parameters?: unknown[]) => Promise<unknown>) {
  const source = new FixtureDataSource({ type: 'mysql', database: 'fixture', entities, synchronize: false })
  await source.prepareMetadata()
  const runner = source.createQueryRunner()
  Object.defineProperty(runner, 'isTransactionActive', { value: true, configurable: true })
  runner.release = async () => {}
  runner.query = async (sql: string, parameters: any = undefined, structured = false): Promise<any> => {
    let records = await query(sql.replaceAll('`', ''), Array.isArray(parameters) ? parameters : undefined)
    // Let real TypeORM hydration consume driver column aliases.
    if (Array.isArray(records)) {
      const aliases = [...sql.matchAll(/`[^`]+`\.`([^`]+)` AS `([^`]+)`/g)]
      records = records.map((record) => ({ ...record, ...Object.fromEntries(aliases
        .filter(([, column, alias]) => record[alias!] === undefined && record[column!] !== undefined)
        .map(([, column, alias]) => [alias, record[column!]])) }))
    }
    if (!structured) {
      return records
    }
    const result = new QueryResult()
    result.raw = records
    result.records = records as any
    result.affected = Number((records as { affectedRows?: number })?.affectedRows || 0)
    return result
  }
  source.createQueryRunner = () => runner
  source.query = (sql, parameters) => query(sql, Array.isArray(parameters) ? parameters : undefined) as any
  return source
}
