import { createHash } from 'node:crypto'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const validAppId = (v) => typeof v === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(v)
export const validVersion = (v) => typeof v === 'string' && v.length <= 48 && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[a-z0-9]+(?:[.-][a-z0-9]+)*)?$/i.test(v)
export const sha256 = (v) => createHash('sha256').update(v).digest('hex')

export async function discoverApplications(root) {
  const applications = []
  for (const entry of await readdir(join(root, 'apps'), { withFileTypes: true })) {
    if (!entry.isDirectory() || !validAppId(entry.name)) {
      continue
    }
    const path = join(root, 'apps', entry.name, 'build.config.json')
    let config
    try {
      if (!(await lstat(path)).isFile()) {
        throw new Error('Build declaration must be a regular file')
      }
      config = JSON.parse(await readFile(path, 'utf8'))
    } catch (error) {
      if (error.code === 'ENOENT') {
        continue
      }
      throw error
    }
    if (config.appId !== entry.name || !/^@t-box\/[a-z0-9-]+$/.test(config.package) ||
      !/^@t-box\/[a-z0-9-]+$/.test(config.releasePackage) ||
      !/^(?:server|contracts)\/dist\/[\w/-]+\.js$/.test(config.releaseModule) ||
      config.releaseModule.split('/').includes('..') || !/^[a-z]\w*$/i.test(config.releaseExport)) {
      throw new Error(`Invalid independent build declaration: ${entry.name}`)
    }
    const web = join(root, 'apps', entry.name, 'web')
    const pkg = JSON.parse(await readFile(join(web, 'package.json'), 'utf8'))
    const releaseDirectory = config.releaseModule.split('/')[0]
    const declaration = JSON.parse(await readFile(join(root, 'apps', entry.name, releaseDirectory, 'package.json'), 'utf8'))
    if (pkg.name !== config.package || declaration.name !== config.releasePackage || !declaration.scripts?.build || !pkg.scripts?.build || !(await lstat(join(web, 'index.html'))).isFile()) {
      throw new Error(`Application has no standalone Web build: ${entry.name}`)
    }
    applications.push(config)
  }
  return applications.sort((a, b) => a.appId.localeCompare(b.appId))
}

/** Same canonical digest and size/path constraints as the API's static artifact importer. */
export async function collectBuildFiles(dist) {
  const files = []
  let bytes = 0
  const scan = async (base, prefix = '') => {
    for (const entry of await readdir(base, { withFileTypes: true })) {
      const path = prefix + entry.name
      if (entry.isDirectory()) {
        await scan(join(base, entry.name), path + '/')
      } else if (entry.isFile()) {
        if (path.length > 240 || !/^[\w./@-]+$/.test(path) || path.split('/').some((v) => !v || v === '.' || v === '..') || path === 'artifact.json') {
          throw new Error(`Unsupported build path: ${path}`)
        }
        const value = await readFile(join(base, entry.name))
        bytes += value.length
        if (value.length > 5 * 1024 * 1024 || bytes > 20 * 1024 * 1024 || files.length >= 2000) {
          throw new Error('Build exceeds artifact limits: 5 MB/file, 20 MB total, 2000 files')
        }
        files.push({ path, content: value.toString('base64') })
      } else {
        throw new Error('Build cannot contain symlinks or special files')
      }
    }
  }
  await scan(dist)
  files.sort((a, b) => a.path.localeCompare(b.path))
  if (!files.some((v) => v.path === 'index.html')) {
    throw new Error('Standalone build must include index.html')
  }
  const manifest = Object.fromEntries(files.map((v) => [v.path, sha256(Buffer.from(v.content, 'base64'))]))
  return { files, artifact: sha256(JSON.stringify(manifest)) }
}

export function workflowOptions(contents, applications) {
  if (!applications.length) {
    throw new Error('No independently buildable applications found')
  }
  const pattern = /(^[ \t]*# BEGIN GENERATED APPLICATIONS\n)[\s\S]*?(^[ \t]*# END GENERATED APPLICATIONS)/m
  if (!pattern.test(contents)) {
    throw new Error('Workflow application markers are missing')
  }
  return contents.replace(pattern, (_, begin, end) => begin + applications.map((a) => `          - ${a.appId}\n`).join('') + end)
}
