# dsh-my-plugin

dsh 插件模板包，演示一个包里同时拥有 **node 端** 与 **浏览器端** 两个面：

- `source/index.ts` → `lib/index.js`：node 侧插件，注册一个 `my-plugin-greet` 工具，支持 `Config` 校验；
- `source/client.ts` → `lib/client.js`：浏览器侧插件，由 dsh 以 classic script 加载。

## manifest 契约

```jsonc
{
  "main": "lib/index.js", // node 端入口
  "exports": {
    ".": { "default": "./lib/index.js" },
    "./client": { "default": "./lib/client.js" }, // 声明 dsh.client 时必须有这个 subpath
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" }, // 作为组合包安装时叠加的 patch 层
    "client": { "platform": "web", "inject": [] }, // 浏览器端声明：platform 必填
  },
  "engines": { "dsh": ">=0.2.0 <0.3.0" },
}
```

只做 node 端插件时，删掉 `exports["./client"]`、`dsh.client` 和 `source/client.ts` 即可，构建脚本会跳过打包。

## 配置

`cordis.patch.yml` 里取消注释即可覆盖 `Config` 默认值：

```yaml
- insert:
    - id: my-plugin
      name: dsh-my-plugin
      config:
        greeting: Hi
```

## 开发

```bash
pnpm build       # 构建（在仓库根执行）
pnpm dev         # 监听
pnpm typecheck
```

## 安装到 profile

```bash
dsh plugin --profile demo add ./packages/my-plugin
dsh --profile demo
```

卸载：`dsh plugin --profile demo remove dsh-my-plugin`。
