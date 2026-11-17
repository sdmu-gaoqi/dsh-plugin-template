import type { Context } from '@deepseek-ai/cordis'

/**
 * 浏览器端插件，与 source/index.ts 组成同一个包的两个面：
 * - index.ts 打给 lib/index.js，跑在 node 侧的 dsh 进程里
 * - client.ts 打给 lib/client.js，由 dsh-client-modules 以 <script> 送到浏览器
 *
 * 注意：client 端会被打成单文件 classic script，所以这里只允许 `import type`。
 * 任何运行时 import（包括相对路径）都会被 esbuild 内联；裸包名会变成 require('x')，
 * 只有宿主模块表里存在的包（如 react、@deepseek-ai/dsh-client-runtime/client）才解析得到。
 *
 * 需要更完整的客户端上下文类型时（slots、会话、设置等），把 Context 换成
 * `ClientContext`（`@deepseek-ai/dsh-client-runtime/client`）。
 */
export const name = 'my-plugin-client'

export function apply(ctx: Context) {
  ctx.effect(() => {
    console.info('[my-plugin] client half loaded')

    return () => {
      console.info('[my-plugin] client half disposed')
    }
  })
}
