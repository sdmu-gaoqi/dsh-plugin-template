# dsh-plugin-build

把插件包 `source/**.ts` 编译成 dsh 需要的 `lib/**.js` 的构建脚本，零配置、无框架绑定。

## 用法

```bash
node packages/build/bin/build.mjs                  # 构建所有包
node packages/build/bin/build.mjs -p packages/foo  # 只构建一个包
node packages/build/bin/build.mjs --watch          # 监听（node 端）
node packages/build/bin/build.mjs --typecheck      # 只做类型检查
node packages/build/bin/build.mjs --clean          # 只清理 lib
```

## 它做了什么

1. 扫描 `packages/*`，凡是同时有 `package.json` 与 `source/` 的目录就是一个待构建的包；
2. 删除旧 `lib/`（避免改名、删文件后残留）；
3. `tsc -p packages/<name>/tsconfig.json`：`source/**.ts` → `lib/**.js`，声明文件 → `lib/types/**.d.ts`；
4. 若存在 `source/client.ts`，用 esbuild 打成单文件 CJS 并套上 `window.__ModuleLoader__.load({ id, factory })` 外壳（dsh 的浏览器模块系统只加载这种 classic script，`id` 取 `package.json` 的 `name`）；
5. 按 `package.json` 的 `main` / `exports` / `dsh.client` 自检产物，缺文件直接报错。

## 为什么 client 端要单独打包

dsh 的浏览器端不是用 ESM 加载插件：`dsh-client-modules` 通过 `<script src="/plugins/<id>/client.js">` 拉取文件，然后要求脚本自己调用 `window.__ModuleLoader__.load({ id, factory })` 注册工厂函数。所以 `lib/client.js` 必须是「单文件 + 外壳 + CJS 语义」，tsc 直出的 ESM 一定会失败。

`factory` 收到的 `require` 只能解析宿主模块表里的包，因此 client 源码里的裸包名会被保留为 `require('x')`，相对路径则内联进同一个文件。

## 依赖

`typescript` 与 `esbuild` 由仓库根 `devDependencies` 提供；esbuild 需要 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies` 放行安装脚本。
