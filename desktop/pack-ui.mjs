import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

async function main() {
  const [directory, version, output] = process.argv.slice(2)
  if (!directory || !output || !/^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){2}$/.test(version)) {
    throw new Error('用法：node desktop/pack-ui.mjs <桌面构建目录> <界面版本> <输出路径>')
  }

  const files = {}
  async function collect(folder = '') {
    for (const entry of await readdir(join(directory, folder), { withFileTypes: true })) {
      const path = join(folder, entry.name)
      if (entry.isDirectory()) {
        await collect(path)
      } else if (entry.isFile()) {
        files[path] = (await readFile(join(directory, path))).toString('base64')
      }
    }
  }
  await collect()
  if (!files['index.html']) {
    throw new Error('缺少界面入口')
  }
  await writeFile(output, JSON.stringify({ protocol: 1, version, files }), { flag: 'wx' })
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
