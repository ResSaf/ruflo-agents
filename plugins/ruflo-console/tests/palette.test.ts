import { describe, expect, mock, test } from 'claude-code/testing'

import { RUFLO_FILES } from './fixtures/ruflo-run'
import { command, elementsOf, keyOf, paneAt, PLUGIN, SESSION, textOf, worldOf } from './fixtures/world'

const runsOf = (runs: readonly string[][], word: string) => runs.filter(argv => argv.includes(word))

describe('palette and /ruflo', () => {
  test('p opens the palette; typing filters; a change asks first and runs one fixed argv on yes', async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command())

    const pane = await $.ui.mount({ ...paneAt(110), surface: 'terminal' as const, plugin: PLUGIN })

    await pane.press({ key: 'palette' })
    expect(elementsOf(await pane.drawn(), 'Input').map(keyOf)).toEqual(['palette-input'])

    await pane.input({ key: 'palette-input', text: 'spawn cod', kind: 'change' })

    const filtered = await pane.drawn()

    expect(elementsOf(filtered, 'Button').map(keyOf).filter(key => key.startsWith('pal-'))[0]).toBe('pal-spawn-coder')

    await pane.press({ key: 'pal-spawn-coder' })
    expect(textOf(await pane.drawn())).toMatch(/Confirm: spawn a coder agent named coder-\d+\?/)
    expect(runsOf(world.runs, 'spawn')).toHaveLength(0)

    await pane.press({ key: 'confirm' })

    const spawn = runsOf(world.runs, 'spawn')[0] ?? []

    expect(spawn.slice(4, 8)).toEqual(['agent', 'spawn', '--type', 'coder'])
    expect(spawn[8]).toBe('--name')
    await pane.unmount()
  })

  test('a read runs at once and shows its output: route <words> asks the router', async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    mock.clock(on)
    world.respond = argv => (argv.includes('route') ? { exitCode: 0, stdout: '{\n "primaryAgent": {"type": "tester", "confidence": 0.8}\n}', stderr: '' } : { exitCode: 0, stdout: '{}', stderr: '' })
    await $.session.start(SESSION)

    const answer = await $.command.run(command('run route write the login tests'))

    expect(answer.text).toBe('route "write the login tests"')
    expect(runsOf(world.runs, 'route')[0]?.slice(4)).toEqual(['hooks', 'route', '--task', 'write the login tests', '--format', 'json'])

    const text = textOf(await $.ui.render(paneAt(110)))

    expect(text).toContain('"type": "tester"')
  })

  test('/ruflo run and /ruflo yes act without focus; a flag-shaped text is refused', async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    expect((await $.command.run(command('run worker-audit'))).text).toBe('Asked: dispatch the audit worker. Confirm with /ruflo yes (or y in the pane), cancel with /ruflo no.')
    expect((await $.command.run(command('yes'))).text).toMatch(/^✓ dispatch the audit worker/)
    expect(runsOf(world.runs, 'dispatch')[0]?.slice(4)).toEqual(['hooks', 'worker', 'dispatch', '--trigger', 'audit'])

    await $.command.run(command('run store --dangerous'))
    expect((await $.command.run(command('yes'))).text).toBe('Nothing is waiting for a confirm.')
    expect(runsOf(world.runs, 'store')).toHaveLength(0)
    expect((await $.command.run(command('run nope'))).text).toMatch(/^No palette entry "nope"/)
  })

  test('approvals: a hive proposal is voted on in place, as console-operator, after a confirm', async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('approvals'))

    const pane = await $.ui.mount({ ...paneAt(110), plugin: PLUGIN })

    await pane.press({ key: 'approve-0' })
    await pane.press({ key: 'confirm' })

    expect(runsOf(world.runs, 'consensus')[0]?.slice(4)).toEqual(['hive-mind', 'consensus', '--action', 'vote', '--proposal-id', 'proposal-1790903321981-23aov7', '--vote', 'yes', '--voter-id', 'console-operator'])
    await pane.unmount()
  })

  test('/ruflo help, an unknown word, and the hints when ruflo-mods or ruflo-swarm are not loaded', async ($, on) => {
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    expect((await $.command.run(command('help'))).text).toContain('/ruflo swarm pane|status|topology|claims|consensus')
    expect((await $.command.run(command('frobnicate'))).text).toMatch(/^Unknown: "frobnicate"/)
    expect((await $.command.run(command('mods'))).text).toMatch(/^ruflo-mods is not loaded in this session/)
    expect((await $.command.run(command('swarm status'))).text).toMatch(/^ruflo-swarm is not loaded in this session/)
  })

  test('the engine saying no hook answered /ruflo mods is not an answer: the hint shows', async ($, on) => {
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    on('command.run', () => ({ text: 'ruflo-console registered /ruflo but no command.run hook answered it: add on("command.run", ...)' }))
    await $.session.start(SESSION)

    expect((await $.command.run(command('mods'))).text).toMatch(/^ruflo-mods is not loaded in this session/)
  })

  test('/ruflo mods and /ruflo swarm <sub> are answered by the plugin beneath that owns them', async ($, on) => {
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    on('command.run', ($, e) => ({ text: `beneath answered: ${e.args}` }))
    await $.session.start(SESSION)

    expect((await $.command.run(command('mods'))).text).toBe('beneath answered: mods')
    expect((await $.command.run(command('swarm topology'))).text).toBe('beneath answered: swarm topology')
    expect((await $.command.run(command('swarm'))).text).toBe('ruflo console: Swarm')
  })

  test('panel auto opens the cockpit at session start without taking the keys; panel command does not', { options: { panel: 'auto' } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    const clock = mock.clock(on)
    await $.session.start(SESSION)
    await clock.advance(100)

    expect(world.openArgs).toHaveLength(1)
    expect(world.openArgs[0]).toMatchObject({ id: 'ruflo-console' })
    expect(world.openArgs[0]?.focus).toBeUndefined()
  })

  test('panel command never opens unasked', { options: { panel: 'command' } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    const clock = mock.clock(on)
    await $.session.start(SESSION)
    await clock.advance(500)

    expect(world.opened).toHaveLength(0)
  })

  test('/ruflo dump <view> answers the view as plain text, without the pane, with its probes run', async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    const claims = (await $.command.run(command('dump claims'))).text ?? ''
    const memory = (await $.command.run(command('dump memory'))).text ?? ''

    expect(claims).toContain('1 active · 1 stealable · 0 handoff')
    expect(claims).toMatch(/console-demo-1\s+coder agent-1790903032181-97m25s/)
    expect(memory).toContain('1 · 0 with vectors')
    expect(world.runs.some(argv => argv.join(' ').includes('memory stats'))).toBe(true)
    expect(world.opened).toHaveLength(0)
  })

  test('panel auto stays shut outside a ruflo project', { options: { panel: 'auto' } }, async ($, on) => {
    const world = worldOf(on, { 'README.md': 'not ruflo' })
    const clock = mock.clock(on)
    await $.session.start(SESSION)
    await clock.advance(500)

    expect(world.openArgs).toHaveLength(0)
  })

  test('/ruflo-console stays registered and is the same command as /ruflo; mods and swarm words still pass beneath', async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    mock.clock(on)
    on('command.run', ($, e) => ({ text: `beneath: ${e.command} ${e.args}` }))
    await $.session.start(SESSION)

    expect([...world.commands].sort()).toEqual(['ruflo', 'ruflo-console'])
    expect((await $.command.run({ ...command('help'), command: 'ruflo-console' })).text).toBe((await $.command.run(command('help'))).text)
    expect((await $.command.run({ ...command('mods'), command: 'ruflo-console' })).text).toBe('beneath: ruflo-console mods')
  })

  test('without a pane (claude -p), /ruflo <view> answers the view as text and opens nothing', async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start({ ...SESSION, isInteractive: false })

    const text = (await $.command.run(command('claims'))).text ?? ''

    expect(text).toContain('1 active · 1 stealable · 0 handoff')
    expect((await $.command.run(command('overview'))).text).toContain('v3.50.0 (npx-offline)')
    expect(world.openArgs).toHaveLength(0)
  })

  test('/ruflo commands browses the catalog, and falls back to the mod commands when it is not readable', async ($, on) => {
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    const text = (await $.command.run(command('commands swarm'))).text ?? ''

    expect(text).toContain('the command catalog is not readable here, so this is the built-in list')
    expect(text).toContain('/ruflo-swarm-pane')
    expect(text).not.toContain('/ruflo-mods ')
  })
})
