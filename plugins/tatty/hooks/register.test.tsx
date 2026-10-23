import { expect, test } from 'claude-code/testing'

const QUESTIONS = [
  { question: 'Go ahead?', header: 'Update', multiSelect: false, options: [{ label: 'Go ahead', description: '' }, { label: 'No', description: '' }] },
]
const TERMINAL = { questions: QUESTIONS, answers: { 'Go ahead?': 'from the terminal' } }

// engine: the hooks that stand for the engine beneath the mod. `answer` is what
// Tatty's /api/answer says; `open` whether server.json is there; `tag` the
// session's TATTY_SESSION (a session Tatty started from a feature page); `join`
// its TATTY_JOIN (Tatty's own session, started by the Desktop app);
// `bodies` collects what was POSTed.
function engine(on: any, open: boolean, answer: object, seen: string[], tag = '', bodies: any[] = [], join = false) {
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('command.register', () => ({ value: { command: 'tatty' } }))
  on('env.get', (_: unknown, e: { name: string }) => ({
    value: e.name === 'TATTY_HOME' ? '/h' : e.name === 'TATTY_SESSION' && tag ? tag : e.name === 'TATTY_JOIN' && join ? '1' : undefined,
  }))
  on('fs.read', () => (open ? { value: JSON.stringify({ port: 9, token: 't', url: 'http://127.0.0.1:9/#token=t' }) } : { deny: 'no such file' }))
  on('http.fetch', (_: unknown, e: { url: string; init?: { body?: string } }) => {
    const path = e.url.replace('http://127.0.0.1:9', '')
    seen.push(path.split('?')[0])
    if (e.init?.body) bodies.push({ path: path.split('?')[0], ...JSON.parse(e.init.body) })
    const body = path.startsWith('/api/status') ? { open: true }
      : path.startsWith('/api/ask') ? { id: 'q1' }
        : path.startsWith('/api/answer/q1') ? answer
          : path.startsWith('/api/inbox') ? { status: 'empty' }
            : { ok: true }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } }
  })
  on('tool.call', () => ({ result: TERMINAL }))
  on('turn.complete', (_: unknown, e: { answer: string }) => ({ text: e.answer }))
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { tokens: 52000, window: 200000 }, cost: { usd: 0.42 } } }))
}

const TURN = (usage: object, extra: object = {}) =>
  ({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'end_turn', usage: { model: 'm', ...usage }, ...extra }) as any
const COUNTS = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5000, cache_creation_input_tokens: 300 }

const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const
const attach = ($: any) => $.command.run({ command: 'tatty', args: 'attach' })

test('a session that has not joined Tatty is left alone', async ($, on) => {
  const seen: string[] = []
  engine(on, true, { status: 'answered', answers: { 'Go ahead?': 'No' } }, seen)
  await $.session.start(START)

  const got = await $.tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS } as any)
  await $.tool.call({ tool: 'Bash', command: 'ls' } as any)
  await new Promise(r => setTimeout(r, 50))
  expect((got as any).result.answers).toEqual(TERMINAL.answers)
  expect(seen).toEqual([]) // not one request to Tatty
})

test("Tatty's own session (TATTY_JOIN) joins by itself, untagged, and asks in Tatty", async ($, on) => {
  const seen: string[] = []
  const bodies: any[] = []
  engine(on, true, { status: 'answered', answers: { 'Go ahead?': 'No' } }, seen, '', bodies, true)
  await $.session.start(START)

  const got = await $.tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS } as any)
  await $.tool.call({ tool: 'Bash', command: 'ls' } as any)
  await new Promise(r => setTimeout(r, 50))
  expect((got as any).result.answers).toEqual({ 'Go ahead?': 'No' })
  expect(seen).toContain('/api/hello')
  expect(bodies.every(b => b.tag === undefined)).toBe(true) // the main feed, not a feature's page
  expect(seen).not.toContain('/api/activity') // and no per-tool reports
})

test('after /tatty attach a question is answered in Tatty', async ($, on) => {
  const seen: string[] = []
  engine(on, true, { status: 'answered', answers: { 'Go ahead?': 'No' } }, seen)
  await $.session.start(START)
  await attach($)

  const got = await $.tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS } as any)
  expect((got as any).result.answers).toEqual({ 'Go ahead?': 'No' })
  expect(seen).toContain('/api/hello')
  expect(seen).toContain('/api/ask')
})

test("a question carries the session's id, which tells Tatty the feature it is about", async ($, on) => {
  const bodies: any[] = []
  engine(on, true, { status: 'answered', answers: { 'Go ahead?': 'No' } }, [], '', bodies)
  await $.session.start(START)
  await attach($)

  await $.tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS } as any)
  const ask = bodies.find(b => b.path === '/api/ask')
  expect(ask.session).toBe('s1')
  expect(ask.questions).toEqual(QUESTIONS)
  expect('tag' in ask).toBe(false) // an untagged session sends no tag
})

test('"answer in terminal instead" falls back to the dialog', async ($, on) => {
  engine(on, true, { status: 'declined' }, [])
  await $.session.start(START)
  await attach($)

  const got = await $.tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS } as any)
  expect((got as any).result.answers).toEqual(TERMINAL.answers)
})

test("with Tatty not open the dialog is the engine's", async ($, on) => {
  const seen: string[] = []
  engine(on, false, {}, seen)
  await $.session.start(START)
  await attach($)

  const got = await $.tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS } as any)
  expect((got as any).result.answers).toEqual(TERMINAL.answers)
  expect(seen).not.toContain('/api/ask')
})

test('a session Tatty started joins by itself and reports its tool calls, tagged', async ($, on) => {
  const seen: string[] = []
  const bodies: any[] = []
  engine(on, true, {}, seen, 's-1', bodies)
  await $.session.start(START)

  await $.tool.call({ tool: 'Bash', command: 'ls', description: 'List the files' } as any)
  // reports are sent without waiting on Tatty: let them land
  await new Promise(r => setTimeout(r, 50))
  const acts = bodies.filter(b => b.path === '/api/activity')
  expect(acts.map(a => a.kind)).toEqual(['tool', 'tool-done'])
  expect(acts[0].text).toBe('List the files')
  expect(acts.every(a => a.tag === 's-1')).toBe(true)
  expect(bodies.find(b => b.path === '/api/hello')?.tag).toBe('s-1')
})

test('a started session reports its running token total, the context and the cost', async ($, on) => {
  const seen: string[] = []
  const bodies: any[] = []
  engine(on, true, {}, seen, 's-1', bodies)
  await $.session.start(START)

  await $.turn.complete(TURN(COUNTS))
  await $.turn.complete(TURN(COUNTS))
  await new Promise(r => setTimeout(r, 50))
  const usage = bodies.filter(b => b.path === '/api/activity' && b.kind === 'usage').map(b => b.usage)
  expect(usage.length).toBe(2)
  expect(usage[0]).toEqual({
    input: 100, output: 20, cacheRead: 5000, cacheWrite: 300, model: 'm',
    context: { tokens: 52000, window: 200000 }, costUsd: 0.42,
  })
  expect(usage[1]).toEqual(expect.objectContaining({ input: 200, output: 40, cacheRead: 10000, cacheWrite: 600 }))
})

test('a session Tatty did not start reports no usage', async ($, on) => {
  const seen: string[] = []
  engine(on, true, {}, seen)
  await $.session.start(START)
  await attach($)

  await $.turn.complete(TURN(COUNTS))
  await new Promise(r => setTimeout(r, 50))
  expect(seen).not.toContain('/api/activity')
})

test('an attached session that Tatty did not start reports no activity', async ($, on) => {
  const seen: string[] = []
  engine(on, true, {}, seen)
  await $.session.start(START)
  await attach($)

  await $.tool.call({ tool: 'Bash', command: 'ls' } as any)
  await new Promise(r => setTimeout(r, 50))
  expect(seen).not.toContain('/api/activity')
})

test('/tatty detach leaves: questions come back to the terminal', async ($, on) => {
  const seen: string[] = []
  engine(on, true, { status: 'answered', answers: { 'Go ahead?': 'No' } }, seen)
  await $.session.start(START)
  await attach($)
  await $.command.run({ command: 'tatty', args: 'detach' })

  const got = await $.tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS } as any)
  expect((got as any).result.answers).toEqual(TERMINAL.answers)
  expect(seen).toContain('/api/bye')
})
