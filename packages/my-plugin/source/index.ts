import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'

/**
 * 插件名：和 cordis.patch.yml 里的行、客户端模块 id 区分开，这里只是日志与调试用的标识。
 */
export const name = 'my-plugin'

/**
 * 声明依赖的服务。Cordis 会等 tools 服务就绪后才调用 apply，
 * 所以 apply 里可以放心使用 ctx.tools。
 */
export const inject = ['tools']

export interface Config {
  /** 工具返回内容的前缀，可在 cordis.patch.yml 的 config 里覆盖。 */
  greeting: string
}

export const Config: Schema<Config> = Schema.object({
  greeting: Schema.string().default('Hello'),
})

export function apply(ctx: Context, config: Config) {
  ctx.tools.register(
    defineTool({
      name: 'my-plugin-greet',
      description: 'Greet someone by name.',
      parameters: {
        name: { type: 'string', required: true, description: 'The name to greet' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args) {
        return `${config.greeting}, ${args.name}!`
      },
    }),
  )
}
