#!/usr/bin/env node
/**
 * 插件构建器：把每个包 source/ 下的 TypeScript 编译成 dsh 认的 lib/ 产物。
 *
 *   packages/<name>/source/index.ts  ->  packages/<name>/lib/index.js    （tsc，node 端 ESM）
 *   packages/<name>/source/client.ts ->  packages/<name>/lib/client.js   （esbuild，浏览器端 classic script）
 *   source/**.ts                     ->  lib/types/**.d.ts             （类型声明，供 exports.types 使用）
 *
 * client.ts 为什么要单独打包：dsh 的浏览器模块系统用 classic script 加载
 * 每个插件的 `<id>/client.js`，文件必须自己调用 window.__ModuleLoader__.load({ id, factory })。
 * 所以这里先把 client.ts 打成单文件 CJS，再用 banner/footer 套上那层壳。
 *
 * 用法：
 *   node packages/build/bin/build.mjs              构建所有包
 *   node packages/build/bin/build.mjs --watch      监听并增量构建
 *   node packages/build/bin/build.mjs --clean      只清理 lib
 *   node packages/build/bin/build.mjs --typecheck  只做类型检查
 *   node packages/build/bin/build.mjs -p packages/my-plugin
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const PACKAGES_DIR = path.join(ROOT, 'packages')
const CLIENT_ENTRY = path.join('source', 'client.ts')
const CLIENT_WRAPPER = 'window.__ModuleLoader__.load({'

const COLOR = process.stdout.isTTY === true && process.env.NO_COLOR === undefined
const paint = (code, text) => (COLOR ? `\u001B[${code}m${text}\u001B[39m` : text)
const dim = (text) => paint(2, text)
const bold = (text) => paint(1, text)
const green = (text) => paint(32, text)
const yellow = (text) => paint(33, text)
const red = (text) => paint(31, text)
const cyan = (text) => paint(36, text)

const LABEL = cyan('[build]')
const rel = (target) => path.relative(ROOT, target).split(path.sep).join('/')

const HELP = `
${bold('dsh 插件构建器')}

  把每个包的 ${dim('source/**.ts')} 编译成 ${dim('lib/**.js')}，并生成 ${dim('lib/types/**.d.ts')}；
  存在 ${dim('source/client.ts')} 时额外产出浏览器端可加载的 ${dim('lib/client.js')}。

${bold('用法')}
  node packages/build/bin/build.mjs [options]

${bold('选项')}
  -p, --package <dir>  只处理指定包（可重复，相对路径按仓库根解析）
  -w, --watch          监听源码变化并增量构建（只监听 node 端，client 端改完需重跑一次）
      --clean          只清理 lib，不构建
  -t, --typecheck      只做类型检查（tsc --noEmit），不产出文件
      --optional       依赖没装好时只提示不报错（给 prepare 钩子用）
  -h, --help           显示帮助
`.trim()

function fail(message) {
  console.error(`${red('[build]')} ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const options = { packages: [], watch: false, clean: false, typecheck: false, help: false, optional: false }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case '-p':
      case '--package': {
        const value = argv[index + 1]
        if (!value) {
          fail(`${arg} 缺少包路径`)
        }
        options.packages.push(path.resolve(ROOT, value))
        index += 1
        break
      }
      case '-w':
      case '--watch': {
        options.watch = true
        break
      }
      case '--clean': {
        options.clean = true
        break
      }
      case '-t':
      case '--typecheck': {
        options.typecheck = true
        break
      }
      case '--optional': {
        options.optional = true
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

/** tsc 入口：从 typescript 的 main 推导，避免依赖 .bin 软链和 shell 差异。 */
function resolveTypeScript(optional) {
  let main
  try {
    main = require.resolve('typescript')
  } catch {
    if (optional) {
      return undefined
    }
    fail('找不到 typescript，先在仓库根执行 pnpm install')
  }
  return path.join(path.dirname(main), 'tsc.js')
}

function resolveEsbuild(optional) {
  try {
    return require('esbuild')
  } catch {
    if (optional) {
      return undefined
    }
    fail('找不到 esbuild，先在仓库根执行 pnpm install')
  }
}

function isPackageDir(dir) {
  const source = path.join(dir, 'source')
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    return false
  }

  return fs.statSync(source, { throwIfNoEntry: false })?.isDirectory() === true
}

function discoverPackages() {
  if (!fs.existsSync(PACKAGES_DIR)) {
    fail(`缺少 packages 目录：${PACKAGES_DIR}`)
  }

  return fs
    .readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(PACKAGES_DIR, entry.name))
    .filter(isPackageDir)
    .sort()
}

function resolveTargets(options) {
  if (options.packages.length === 0) {
    return discoverPackages()
  }

  for (const target of options.packages) {
    if (!fs.existsSync(path.join(target, 'package.json'))) {
      fail(`不是包目录（缺少 package.json）：${rel(target)}`)
    }
    if (!fs.existsSync(path.join(target, 'source'))) {
      fail(`不是插件包（缺少 source/）：${rel(target)}`)
    }
    if (!fs.existsSync(path.join(target, 'tsconfig.json'))) {
      fail(`缺少 tsconfig.json：${rel(target)}，可从其他包复制一份`)
    }
  }

  return options.packages
}

function readManifest(target) {
  return JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'))
}

function runTsc({ tscBin, target, extraArgs, watch }) {
  const args = [tscBin, '-p', path.join(target, 'tsconfig.json'), ...extraArgs]
  const child = spawn(process.execPath, args, { cwd: target, stdio: 'inherit' })

  if (watch) {
    return child
  }

  return new Promise((resolve) => {
    child.on('error', (error) => {
      console.error(red(`[build] 启动 tsc 失败：${error.message}`))
      resolve(1)
    })
    child.on('close', (code) => resolve(code ?? 1))
  })
}

/** 把 client 端打成 classic script：单文件 CJS + __ModuleLoader__ 外壳。 */
async function bundleClient({ esbuild, target, packageName }) {
  const header = [
    CLIENT_WRAPPER,
    `  id: ${JSON.stringify(packageName)},`,
    '  factory: (require) => {',
    '    var module = { exports: {} }',
    '    var exports = module.exports',
    "    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })",
    '',
  ].join('\n')
  const footer = ['', '    return module.exports', '  },', '})', ''].join('\n')

  await esbuild.build({
    entryPoints: [path.join(target, CLIENT_ENTRY)],
    outfile: path.join(target, 'lib', 'client.js'),
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    // 裸包名留成 require('x')，交给浏览器侧的模块表解析；相对路径才内联。
    packages: 'external',
    sourcemap: true,
    banner: { js: header },
    footer: { js: footer },
    logLevel: 'warning',
  })
}

/** 收集 package.json 里声明的产物入口，用于构建后自检。 */
function declaredEntries(pkg) {
  const entries = new Set()
  if (typeof pkg.main === 'string') {
    entries.add(pkg.main)
  }

  const walk = (value) => {
    if (typeof value === 'string') {
      entries.add(value)
      return
    }
    if (value === null || typeof value !== 'object') {
      return
    }
    for (const child of Object.values(value)) {
      walk(child)
    }
  }
  walk(pkg.exports)

  return entries
}

function verifyTarget(target, pkg) {
  const missingRuntime = []
  const missingTypes = []

  for (const entry of declaredEntries(pkg)) {
    if (!entry.startsWith('./')) {
      continue
    }
    if (fs.existsSync(path.join(target, entry))) {
      continue
    }
    if (entry.endsWith('.d.ts')) {
      missingTypes.push(entry)
    } else if (entry.endsWith('.js')) {
      missingRuntime.push(entry)
    }
  }

  if (missingRuntime.length > 0) {
    const expected = missingRuntime.map((entry) => {
      const source = entry
        .replace(/^\.\//, '')
        .replace(/^lib\//, '')
        .replace(/\.js$/, '.ts')
      return `source/${source}`
    })
    fail(
      `${rel(target)} 产物缺失：${missingRuntime.join(', ')}\n` +
        `        package.json 的 exports/main 指向了不存在的文件，检查源码：${expected.join(', ')}`,
    )
  }

  if (missingTypes.length > 0) {
    console.warn(yellow(`${LABEL} ${rel(target)} 类型声明缺失：${missingTypes.join(', ')}（编辑器跳转会失效）`))
  }

  if (pkg.dsh?.client === undefined) {
    return
  }

  // client-modules 只认 exports["./client"] 这个 subpath，缺了浏览器端根本找不到包。
  if (pkg.exports?.['./client'] === undefined) {
    fail(`${rel(target)} 声明了 dsh.client，但 package.json 没有导出 "./client" 子路径`)
  }

  const bundlePath = path.join(target, 'lib', 'client.js')
  if (!fs.existsSync(bundlePath)) {
    fail(`${rel(target)} 声明了 dsh.client，但没有产出 lib/client.js（检查 source/client.ts）`)
  }

  // tsc 先产出的是 ESM，esbuild 覆盖后才带外壳；外壳缺失说明浏览端会加载失败。
  const head = fs.readFileSync(bundlePath, 'utf8').slice(0, CLIENT_WRAPPER.length)
  if (head !== CLIENT_WRAPPER) {
    fail(`${rel(target)}/lib/client.js 不是 __ModuleLoader__ 格式，浏览器端会加载失败`)
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(HELP)
    return
  }

  const targets = resolveTargets(options)
  if (targets.length === 0) {
    fail('没有找到可构建的包：packages/*/ 需要同时具备 package.json 与 source/')
  }

  if (options.clean) {
    for (const target of targets) {
      fs.rmSync(path.join(target, 'lib'), { recursive: true, force: true })
      console.log(`${LABEL} 清理 ${rel(target)}/lib`)
    }
    return
  }

  const tscBin = resolveTypeScript(options.optional)
  if (tscBin === undefined) {
    console.warn(yellow(`${LABEL} 跳过构建：依赖没装好，先执行 pnpm install && pnpm build`))
    return
  }

  if (options.typecheck) {
    let failed = false
    for (const target of targets) {
      console.log(`${LABEL} 类型检查 ${bold(rel(target))}`)
      const code = await runTsc({ tscBin, target, extraArgs: ['--noEmit'], watch: false })
      if (code !== 0) {
        failed = true
      }
    }
    if (failed) {
      fail('类型检查未通过')
    }
    console.log(green(`${LABEL} 类型检查通过`))
    return
  }

  // 产物目录整体重建，避免改名/删除源码后残留旧的 lib 文件。
  for (const target of targets) {
    fs.rmSync(path.join(target, 'lib'), { recursive: true, force: true })
  }

  if (options.watch) {
    const children = targets.map((target) => {
      console.log(`${LABEL} 监听 ${bold(rel(target))} ${dim('source/ -> lib/')}`)
      return runTsc({ tscBin, target, extraArgs: ['--watch', '--preserveWatchOutput'], watch: true })
    })

    const stop = () => {
      for (const child of children) {
        child.kill()
      }
      process.exit(0)
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
    return
  }

  const esbuild = targets.some((target) => fs.existsSync(path.join(target, CLIENT_ENTRY)))
    ? resolveEsbuild(options.optional)
    : undefined

  for (const target of targets) {
    const started = Date.now()
    const pkg = readManifest(target)
    console.log(`${LABEL} 构建 ${bold(rel(target))}`)

    const code = await runTsc({ tscBin, target, extraArgs: [], watch: false })
    if (code !== 0) {
      fail(`${rel(target)} 构建失败（tsc 退出码 ${code}）`)
    }

    if (fs.existsSync(path.join(target, CLIENT_ENTRY))) {
      await bundleClient({ esbuild, target, packageName: pkg.name })
      console.log(`${LABEL} client 端打包 ${dim('source/client.ts -> lib/client.js')}`)
    }

    verifyTarget(target, pkg)
    console.log(`${green('[build]')} 完成 ${rel(target)}${dim(` (${Date.now() - started}ms)`)}`)
  }

  console.log(green(`${LABEL} 全部完成：${targets.length} 个包`))
}

await main()
