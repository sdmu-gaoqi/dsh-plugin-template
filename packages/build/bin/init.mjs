#!/usr/bin/env node
/**
 * 模板初始化：把模板里的占位名 my-plugin 改成真实插件名。
 * 供 CLI（脚手架）在拷贝模板后调用，也可以手动执行。
 *
 *   node packages/build/bin/init.mjs --name hello
 *   node packages/build/bin/init.mjs --name hello --dry-run
 *
 * 改名范围：
 *   - 根 package.json 的 name
 *   - packages/my-plugin/package.json 的 name（dsh-<name>）
 *   - cordis.patch.yml 里的行 id 与包名
 *   - source/*.ts 里的插件 name 与工具名
 *   - 其余文档中出现的 my-plugin / dsh-my-plugin
 *   - packages/my-plugin 目录名
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const TEMPLATE_SLUG = 'my-plugin'
const TEMPLATE_PACKAGE = 'dsh-my-plugin'
const SKIP_DIRS = new Set(['node_modules', 'lib', 'dist', 'coverage', '.turbo', '.git', '.vscode'])
// 构建工具自身与锁文件不参与改名：前者是通用脚本，后者会随安装重新生成。
const SKIP_PATHS = ['packages/build', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']
const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.yml',
  '.yaml',
  '.md',
  '.txt',
])

const COLOR = process.stdout.isTTY === true && process.env.NO_COLOR === undefined
const paint = (code, text) => (COLOR ? `\u001B[${code}m${text}\u001B[39m` : text)
const dim = (text) => paint(2, text)
const green = (text) => paint(32, text)
const red = (text) => paint(31, text)
const cyan = (text) => paint(36, text)

const LABEL = cyan('[init]')

const HELP = `
${paint(1, '模板初始化')}

${paint(1, '用法')}
  node packages/build/bin/init.mjs --name <插件名> [--dry-run]

${paint(1, '说明')}
  插件名用 kebab-case，可带或不带 dsh- 前缀：--name hello 与 --name dsh-hello 等价。
`.trim()

function fail(message) {
  console.error(`${red('[init]')} ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const options = { name: '', dryRun: false, help: false }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case '-n':
      case '--name': {
        options.name = argv[index + 1] ?? ''
        if (!options.name) {
          fail('--name 缺少插件名')
        }
        index += 1
        break
      }
      case '--dry-run': {
        options.dryRun = true
        break
      }
      case '-h':
      case '--help': {
        options.help = true
        break
      }
      default: {
        fail(`未知参数 ${arg}，用 --help 查看用法`)
      }
    }
  }

  return options
}

function findTemplatePackageDir() {
  const packagesDir = path.join(ROOT, 'packages')
  if (!fs.existsSync(packagesDir)) {
    fail('缺少 packages 目录，脚本应在模板仓库内执行')
  }

  const candidates = fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packagesDir, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'source', 'index.ts')))

  if (candidates.length === 0) {
    fail('没有找到插件包（packages/*/source/index.ts），模板可能已经初始化过了')
  }

  return candidates[0]
}

function collectFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name)
    const relative = path.relative(ROOT, absolute).split(path.sep).join('/')
    if (SKIP_PATHS.some((skip) => relative === skip || relative.startsWith(`${skip}/`))) {
      continue
    }

    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        collectFiles(absolute, files)
      }
      continue
    }
    if (TEXT_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(absolute)
    }
  }

  return files
}

function rewriteRootManifest(slug, dryRun) {
  const manifestPath = path.join(ROOT, 'package.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (manifest.name === slug) {
    return false
  }

  manifest.name = slug
  if (!dryRun) {
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  }

  return true
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(HELP)
    return
  }

  const rawName = options.name.trim().toLowerCase()
  if (!/^[a-z][a-z\d-]*$/.test(rawName.replace(/^dsh-/, ''))) {
    fail(`插件名不合法：${rawName}（只允许小写字母、数字、中划线，且以字母开头）`)
  }

  const slug = rawName.replace(/^dsh-/, '')
  const packageName = `dsh-${slug}`
  if (slug === TEMPLATE_SLUG) {
    console.log(`${LABEL} 插件名与模板默认值相同，无需改名`)
    return
  }

  const pluginDir = findTemplatePackageDir()
  const targetDir = path.join(ROOT, 'packages', slug)
  if (targetDir !== pluginDir && fs.existsSync(targetDir)) {
    fail(`目标目录已存在：${path.relative(ROOT, targetDir)}`)
  }

  const changes = []

  for (const file of collectFiles(ROOT)) {
    const source = fs.readFileSync(file, 'utf8')
    if (!source.includes(TEMPLATE_SLUG)) {
      continue
    }

    // 先替换带 dsh- 前缀的包名，再替换裸 slug，避免出现 dsh-dsh-xxx。
    const next = source.split(TEMPLATE_PACKAGE).join(packageName).split(TEMPLATE_SLUG).join(slug)
    if (next === source) {
      continue
    }

    if (!options.dryRun) {
      fs.writeFileSync(file, next)
    }
    changes.push(path.relative(ROOT, file).split(path.sep).join('/'))
  }

  if (rewriteRootManifest(slug, options.dryRun)) {
    changes.push('package.json')
  }

  if (targetDir !== pluginDir) {
    if (!options.dryRun) {
      fs.renameSync(pluginDir, targetDir)
    }
    changes.push(`${path.relative(ROOT, pluginDir).split(path.sep).join('/')}/ -> packages/${slug}/`)
  }

  if (changes.length === 0) {
    console.log(`${LABEL} 没有需要修改的内容`)
    return
  }

  console.log(`${LABEL} ${options.dryRun ? '将修改（dry-run，未写入）' : '已修改'}：`)
  for (const change of changes) {
    console.log(`  ${green('·')} ${change}`)
  }

  console.log('')
  console.log(`${LABEL} 下一步：`)
  console.log(dim(`  pnpm install && pnpm build`))
  console.log(dim(`  dsh plugin --profile demo add ./packages/${slug}`))
  console.log(dim(`  dsh --profile demo`))
}

main()
