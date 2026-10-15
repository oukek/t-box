import { readdir, readlink, realpath, rm } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

export async function verifyDeploymentLinks(directory) {
  const root = await realpath(directory)
  const hoisted = join(root, 'node_modules/.pnpm/node_modules') + '/'
  async function scan(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const file = join(path, entry.name)
      if (entry.isSymbolicLink()) {
        let target
        try {
          target = await realpath(file)
        } catch (error) {
          if (error.code === 'ENOENT' && file.startsWith(hoisted)) {
            await rm(file)
            continue
          }
          throw error
        }
        if (isAbsolute(await readlink(file)) || !target.startsWith(root + '/')) {
          // Legacy deploy retains hoisted aliases to the original workspace/root package.
          // These aliases are not the production graph's direct or installed package links.
          if (file.startsWith(hoisted)) {
            await rm(file)
            continue
          }
          throw new Error('Nonportable production dependency link: ' + file)
        }
      } else if (entry.isDirectory()) {
        await scan(file)
      }
    }
  }
  await scan(root)
}
