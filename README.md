# dsh 插件模板（TypeScript）

用 TypeScript 写 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）插件的最小工程。

dsh 只按 `package.json` 的 `main` / `exports` 加载 `lib/**.js`，所以仓库里 **源码是 `source/`，产物是 `lib/`**，中间的转换由 `packages/build` 里的构建脚本完成——这就是本模板存在的原因。

## 目录结构

```
.
├── packages/
│   ├── build/                  # 构建脚本（不产出 lib，纯工具）
│   │   └── bin/
│   │       ├── build.mjs       # source/**.ts -> lib/**.js
│   │       └── init.mjs        # 模板改名（给 CLI 或手动用）
│   └── my-plugin/              # ← 你的插件包
│       ├── package.json        # main/exports/dsh.client/dsh.bundle
│       ├── cordis.patch.yml    # 组合包 patch：往 profile 里插一行
│       ├── tsconfig.json
│       └── source/
│           ├── index.ts        # node 端插件（注册工具，可用 ctx）
│           └── client.ts       # 浏览器端插件（可选）
├── tsconfig.base.json          # 共享编译选项（strict / nodenext / ESM）
├── .oxlintrc.json              # 继承 @wagq/lint-ox/oxlint/base.json
└── pnpm-workspace.yaml
```

## 快速开始

```bash
pnpm install        # prepare 钩子会自动跑一次 build
pnpm build          # 手动构建：source/ -> lib/
```

> 仓库根同时声明了 `workspaces`，npm / yarn 也能直接 `npm install` 开发；团队默认的包管理器仍是 pnpm（dsh 的 `dsh plugin add` 也用 pnpm）。`lib/` 不入库，所以装进 profile 之前必须先 build 一次。

装进本地 profile 跑起来（需要 `npm i -g @deepseek-ai/dsh`，dsh 本体要 Node >= 24.9）：

```bash
dsh plugin --profile demo add ./packages/my-plugin
dsh --profile demo
```

## 源码 → 产物映射

| 源码                 | 产物                | 处理方式                          | 说明                                      |
| -------------------- | ------------------- | --------------------------------- | ----------------------------------------- |
| `source/index.ts`    | `lib/index.js`      | tsc                               | node 端插件，ESM，正常 `import` 即可      |
| `source/client.ts`   | `lib/client.js`     | esbuild + `__ModuleLoader__` 外壳 | 浏览器端插件，dsh 以 classic script 加载  |
| `source/**.ts`       | `lib/types/**.d.ts` | tsc                               | 类型声明，供 `exports.types` 与编辑器跳转 |
| 新增 `source/foo.ts` | `lib/foo.js`        | tsc                               | 自动跟随，无需改配置                      |

构建脚本会做三件事，缺一不可：

1. `tsc -p packages/<name>/tsconfig.json` 产出 `lib/**.js` + `lib/types/**.d.ts`；
2. 如果存在 `source/client.ts`，用 esbuild 打成单文件 CJS，再套上 `window.__ModuleLoader__.load({ id, factory })` 外壳——dsh 的浏览器模块系统只认这个格式，直出的 ESM 会加载失败；
3. 按 `package.json` 的 `main` / `exports` 自检产物是否存在、`lib/client.js` 是否带外壳。

## 命令

| 命令                                | 作用                                                     |
| ----------------------------------- | -------------------------------------------------------- |
| `pnpm build`                        | 构建所有包                                               |
| `pnpm dev`                          | 监听 `source/` 增量编译（client 端改动需重跑一次 build） |
| `pnpm clean`                        | 删除所有 `lib/`                                          |
| `pnpm typecheck`                    | `tsc --noEmit`，不产出文件                               |
| `pnpm lint` / `pnpm lint:fix`       | oxlint（规则来自 `@wagq/lint-ox`）                       |
| `pnpm format` / `pnpm format:check` | oxfmt                                                    |
| `pnpm run rename --name hello`      | 把模板占位名改成真实插件名                               |

## 代码规范：@wagq/lint-ox

> 注意：`@wagq/lint-ox` 版本升级时 `peerDependencies` 会跟着升（当前基线 oxlint 1.90 / oxfmt 0.75）。`oxfmt` 的 caret 范围在 0.x 上只覆盖小版本，所以这里锁 `0.75.0`，升级时和 `@wagq/lint-ox` 一起改。

- **lint**：`.oxlintrc.json` 用 `extends` 指向 `./node_modules/@wagq/lint-ox/oxlint/base.json`（纯 TS / Node 库预设），并补了 `env.node` 与 `**/lib/**` 忽略。要写 React / Vue 时把 extends 换成 `react.json` / `vue.json` / `recommended.json`。
- **format**：不落地本地配置文件，命令行直接 `-c ./node_modules/@wagq/lint-ox/oxfmt.json`，保证和团队默认值一致；`lib/` 已在脚本里通过配置文件忽略，产物不会被格式化。
- **编辑器**：装 Oxc 官方扩展 `oxc.oxc-vscode`，`.vscode/settings.json` 已配好保存时格式化 + fixAll。
- **提交前**（可选）：装 husky + lint-staged 后，把下面这段加到 `package.json`：

```json
{
  "lint-staged": {
    "*.{js,jsx,ts,tsx,mts,cts,vue}": "oxlint -c ./node_modules/@wagq/lint-ox/oxlint/base.json --fix",
    "*.{js,jsx,ts,tsx,mts,cts,vue,json,jsonc,css,scss,less,md,yml,yaml}": "oxfmt -c ./node_modules/@wagq/lint-ox/oxfmt.json --write --no-error-on-unmatched-pattern"
  }
}
```

提交信息校验复用 `@wagq/lint-ox/commit`：

```js
// commitlint.config.mjs
import commitConfig from '@wagq/lint-ox/commit'

export default commitConfig
```

## 新增一个插件包

1. 复制 `packages/my-plugin` 为 `packages/<name>`；
2. 改 `packages/<name>/package.json` 的 `name`（建议 `dsh-` 前缀）；
3. 改 `cordis.patch.yml` 里的行 `id` 与 `name`，以及 `source/*.ts` 里的插件 `name`；
4. 保持 `exports["./client"]` 与 `dsh.client` 同时存在（否则浏览器端加载不到），或两者一起删掉；
5. `pnpm build`。

## 通过 CLI 初始化

模板的占位名是 `my-plugin` / `dsh-my-plugin`，脚手架把模板拷到目标目录后跑一次即可：

```bash
node packages/build/bin/init.mjs --name hello [--dry-run]
# 等价于
pnpm run rename --name hello
```

它会改掉：根 `package.json` 的 `name`、插件包 `name`、`cordis.patch.yml` 的行 id 与包名、`source/*.ts` 里的插件名与工具名、文档里出现的占位名，并把 `packages/my-plugin` 目录改名。

## 约定与坑

- **相对 import 要写 `.js` 后缀**：`module: nodenext` 下 `import { a } from './a.js'`，否则 tsc 直接报错。
- **`client.ts` 只能 `import type`**：client 端会被打成单文件 classic script，裸包名会变成 `require('x')`，只有宿主模块表里有的包（`react`、`@deepseek-ai/dsh-client-runtime/client` 等）才解析得到；相对路径会被内联。
- **`dsh.*` 依赖双写**：需要与宿主共享实例的包（`@deepseek-ai/cordis`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/schemastery`）同时放 `peerDependencies` 与 `devDependencies`——peer 给运行时，dev 给类型检查和独立构建。
- **版本跟宿主对齐**：`@deepseek-ai/dsh-tools` 的 peer 全是**精确版本**（如 `0.2.2-rc.3`）。升级 dsh 时把 `@deepseek-ai/*` 的 peer 与 dev 一起升，否则运行时会出现两份实例、类型也对不上。用 `next` 线（`0.2.2-rc.x`）而不是 `latest`（`0.0.1-rc.1`，那条线的传递依赖还依赖未发布的包，装不上）。
- **`lib/` 不入库**：发布走 `prepare` 构建（`pnpm publish` 与 `github:` 安装都会跑）。从 git 安装时，用户要在 profile 的 `pnpm-workspace.yaml` 里给这个包开 `allowBuilds`，否则 pnpm 拒绝执行 `prepare`。
- **`prepare` 带 `--optional`**：`pnpm install` 时依赖还没齐，构建脚本只提示不报错；手动 `pnpm build` 才会在缺件时失败。
- **`engines.dsh`**：声明支持的 dsh 版本范围，安装与启动会校验，不满足直接拒绝。
- **配置不要硬编码**：任何不同部署可能不同的值都放进 `Config` schema，让用户在 `cordis.patch.yml` 里改。

## 参考

- dsh 文档：<https://deepseek-harness.github.io/deepseek-harness/>（插件入门、工具 DSL、打包与安装）
- `@wagq/lint-ox`：团队 oxlint + oxfmt 统一配置
