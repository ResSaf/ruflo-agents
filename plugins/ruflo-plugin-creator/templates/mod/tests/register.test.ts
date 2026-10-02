import { describe, expect, test, tier } from 'claude-code/testing'

tier('user')

describe('register', () => {
  test('counts tool calls in the status line and answers /my-mod-status', async ($, on) => {
    const env = new Map<string, string>()
    const statuses: (string | undefined)[] = []
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('env.set', ($, e) => (e.value === undefined ? env.delete(e.name) : env.set(e.name, e.value), { value: undefined }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.status', ($, e) => (statuses.push(e.text), { value: undefined }))
    on('tool.call', () => ({ result: 'ok' }))
    on('command.run', () => ({ text: 'core' }))

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    expect(env.get('MY_MOD_ACTIVE')).toBe('1')

    await $.tool.call({ tool: 'Bash', command: 'ls' })
    await $.tool.call({ tool: 'Bash', command: 'pwd' })
    expect(statuses.at(-1)).toBe('my-mod · 2 tool calls')

    const { text } = await $.command.run({
      command: 'my-mod-status',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 100 },
    })
    expect(text).toBe('my-mod · 2 tool calls')
  })
})
