// Tatty: connects a Claude Code session to Tatty's window (the tray companion,
// or a browser tab), served by app/server.py. Three things only a mod can do:
//   - AskUserQuestion is asked in Tatty when it is open (any skill, no edits);
//   - text typed in Tatty is submitted to the session as the user's prompt;
//   - each answer the session gives is mirrored into Tatty.
// Only in a session that has joined: one Tatty started from a feature page
// (it carries TATTY_SESSION, and also reports what it does: each tool call,
// prompt and reply, for that feature's page), or one where /tatty open or
// /tatty attach was run. Every other session runs as if Tatty weren't installed.
import type { EngineInterface, Register } from 'claude-code'

type Info = { port: number; token: string; url: string }
type Question = { question: string; header?: string; options: { label: string }[]; multiSelect?: boolean }
type Answer = { status: 'pending' | 'answered' | 'declined'; answers?: Record<string, string> }

const POLL_MS = 1500
const ASK_WAIT_S = 25

// The module's own: they start over when the mod reloads, and attach() finds
// the window again from server.json.
let attached: Info | null = null
let polling = false
let session = ''
let tag = '' // set when Tatty started this session from a feature page
let joined = false // this session works with Tatty (tagged, or /tatty open|attach)
// What a started session has used so far, summed over its turns (the engine
// answers per turn; the window and cost it has as a whole, see reportUsage).
const spent = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

async function home($: EngineInterface): Promise<string> {
  const own = await $.env.get('TATTY_HOME')
  if (own) return own
  const config = await $.env.get('CLAUDE_CONFIG_DIR')
  if (config) return `${config}/tatty`
  const user = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '~'
  return `${user}/.claude/tatty`
}

async function api($: EngineInterface, info: Info, path: string, body?: Record<string, unknown>): Promise<any> {
  const r = await $.http.fetch(`http://127.0.0.1:${info.port}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-TT-Token': info.token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(tag ? { ...body, tag } : body),
  })
  if (!r.ok) throw new Error(`Tatty: ${path} answered ${r.status}`)
  return JSON.parse(r.text)
}

// find: the running window from server.json, or null
async function find($: EngineInterface): Promise<Info | null> {
  try {
    const info = JSON.parse(await $.fs.read(`${await home($)}/server.json`)) as Info
    const st = await api($, info, '/api/status')
    return st.open ? info : null
  } catch {
    return null
  }
}

async function attach($: EngineInterface): Promise<Info | null> {
  if (!joined) return null
  const info = await find($)
  if (info && info.token !== attached?.token) {
    await api($, info, '/api/hello', { session }).catch(() => undefined)
    $.ui.status(tag ? 'Tatty: this session shows on its feature page' : 'Tatty: attached')
  }
  if (!info && attached) $.ui.status(undefined)
  attached = info
  return info
}

async function detach($: EngineInterface) {
  if (attached) await api($, attached, '/api/bye', {}).catch(() => undefined)
  attached = null
  joined = false
  $.ui.status(undefined)
}

// report: what a started session is doing, for its feature page. Never waits
// the session on the window, and never fails it.
function report($: EngineInterface, body: Record<string, unknown>) {
  if (!tag || !attached) return
  void api($, attached, '/api/activity', body).catch(() => undefined)
}

// reportUsage: add a turn's token counts to the session's total, and tell the
// feature page the total, the context window's fill and the cost. The total is
// cumulative, so a repeat or a missed report costs nothing.
async function reportUsage($: EngineInterface, turn: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; model?: string } | undefined) {
  if (!tag || !attached || !turn) return
  spent.input += turn.input_tokens || 0
  spent.output += turn.output_tokens || 0
  spent.cacheRead += turn.cache_read_input_tokens || 0
  spent.cacheWrite += turn.cache_creation_input_tokens || 0
  const now = await $.session.usage()
  report($, {
    kind: 'usage',
    usage: {
      ...spent,
      model: turn.model || '',
      context: { tokens: now.context.tokens, window: now.context.window },
      costUsd: now.cost?.usd,
    },
  })
}

// The few words that say what a tool call is about.
function about(e: any): string {
  const v = e.description || e.file_path || e.notebook_path || e.pattern || e.url || e.skill || e.query || e.command || e.prompt || ''
  return String(v).replace(/\s+/g, ' ').slice(0, 300)
}

// findBash: the bash that runs tatty.sh. $.process.run has no shell and only the
// session's PATH, which on Windows often lacks Git Bash, so look where Git for
// Windows installs (per user, then per machine) before trusting a bare `bash`.
async function findBash($: EngineInterface): Promise<string> {
  const set = await $.env.get('CLAUDE_CODE_GIT_BASH_PATH')
  if (set) return set
  const roots = [
    `${(await $.env.get('LOCALAPPDATA')) || ''}/Programs/Git`,
    `${(await $.env.get('ProgramFiles')) || 'C:/Program Files'}/Git`,
    `${(await $.env.get('ProgramFiles(x86)')) || 'C:/Program Files (x86)'}/Git`,
  ]
  for (const root of roots) {
    for (const sub of ['bin/bash.exe', 'usr/bin/bash.exe']) {
      if (root.startsWith('/')) continue // LOCALAPPDATA was not set
      if (await $.fs.exists(`${root}/${sub}`)) return `${root}/${sub}`
    }
  }
  return 'bash'
}

async function tattySh($: EngineInterface, args: string[]) {
  const script = `${$.plugin.root}/scripts/tatty.sh`
  const bash = await findBash($)
  // `open` may build the tray companion the first time, which takes a minute or so.
  return $.process.run([bash, script, ...args], { timeoutMs: 300000 })
}

// pollInbox: one short poll; a message typed in Tatty (for a started session:
// on its feature page) becomes the user's next prompt, queued until idle.
async function pollInbox($: EngineInterface) {
  if (polling || !joined) return
  polling = true
  try {
    const info = attached ?? (await attach($))
    if (!info) return
    const got = await api($, info, `/api/inbox?wait=0&client=claude-mod${tag ? `&tag=${tag}` : ''}`)
    if (got.status === 'message') await $.prompt.submit({ text: got.text, asUser: true })
  } catch {
    attached = null
    $.ui.status(undefined)
  } finally {
    polling = false
  }
}

// The /tatty command: open (the default), attach, detach, close or status.
async function runTatty($: EngineInterface, args: string): Promise<{ text: string }> {
  const verb = args.trim() || 'open'
  if (verb === 'open') {
    const r = await tattySh($, ['open'])
    if (r.exitCode === 3) return { text: 'No Python 3.8+ found, so Tatty is not available here.' }
    if (r.exitCode !== 0) return { text: `Tatty didn't open: ${(r.stderr || r.stdout).trim()}` }
    joined = true
    const info = await attach($)
    return { text: info ? 'Tatty is open, and this session works with it: questions are asked there.' : 'Tatty started, but this session could not attach to it.' }
  }
  if (verb === 'attach') {
    joined = true
    const info = await attach($)
    return { text: info ? 'This session now works with Tatty.' : 'Tatty is not open. /tatty open starts it.' }
  }
  if (verb === 'detach') {
    await detach($)
    return { text: 'This session no longer works with Tatty; questions come back to the terminal.' }
  }
  if (verb === 'close') {
    await detach($)
    await tattySh($, ['close'])
    return { text: "Tatty's window is closed. Questions come back to the terminal." }
  }
  if (verb === 'status') {
    const info = joined ? await attach($) : await find($)
    if (!info) return { text: 'Tatty is not open. /tatty open starts it.' }
    return { text: joined ? `This session works with Tatty: ${info.url.split('#')[0]}` : 'Tatty is open, but this session does not work with it. /tatty attach joins.' }
  }
  return { text: 'usage: /tatty [open | attach | detach | close | status]' }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    session = await $.session.id()
    tag = (await $.env.get('TATTY_SESSION')) || ''
    joined = Boolean(tag)
    Object.assign(spent, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
    await $.command.register({
      name: 'tatty',
      description: 'Open Tatty, or have this session work with it (attach / detach), or close it',
      argumentHint: '[open | attach | detach | close | status]',
    })
    if (joined) await attach($)
    $.clock.every(POLL_MS, () => void pollInbox($))
    return started
  })

  // A throw here would make the engine skip the hook and report that nothing answered
  // /tatty, so the work is in runTatty and a failure is said in words.
  on('command.run', { command: 'tatty' }, async ($, e) => {
    try {
      return await runTatty($, e.args ?? '')
    } catch (err) {
      return { text: `/tatty failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  })

  // AskUserQuestion: asked in Tatty while it is open. "Answer in terminal
  // instead", an unreachable window or an interrupt fall back to the engine's dialog.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    if (!joined) return next(e)
    const info = attached ?? (await attach($))
    if (!info) return next(e)
    const questions = e.questions as Question[]
    let id: string
    try {
      id = (await api($, info, '/api/ask', { questions, source: 'Claude' })).id
    } catch {
      return next(e)
    }
    $.ui.status('Tatty: waiting for your answer there')
    try {
      while (!next.signal?.aborted) {
        const got = (await api($, info, `/api/answer/${id}?wait=${ASK_WAIT_S}`)) as Answer
        if (got.status === 'answered') return { result: { questions, answers: got.answers ?? {} } as any }
        if (got.status === 'declined') break
      }
    } catch {
      attached = null
    } finally {
      $.ui.status(attached ? 'Tatty: attached' : undefined)
    }
    return next(e)
  }).catch(($, e, next) => next(e)) // a failing hook still asks in the terminal

  // A started session: each tool call, as it starts and as it finishes.
  on('tool.call', async ($, e, next) => {
    if (!tag || e.agentId) return next(e)
    const id = e.tool_use_id || `${e.tool}-${Date.now()}`
    report($, { kind: 'tool', tool: String(e.tool), text: about(e), id })
    const done = await next(e)
    report($, { kind: 'tool-done', tool: String(e.tool), id, ok: !('deny' in done) && !(done as any).isError })
    return done
  }).catch(($, e, next) => next(e)) // reporting must never stop a tool

  // A started session: what the person asked it (typed, or sent from Tatty).
  on('prompt.submit', async ($, e, next) => {
    if (tag) report($, { kind: 'prompt', text: String(e.text || '').slice(0, 400) })
    return next(e)
  }).catch(($, e, next) => next(e))

  // Mirror the session's answers into Tatty, so it reads like a chat. A started
  // session's go to its feature page instead of the main feed.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await reportUsage($, e.usage).catch(() => undefined) // never fails the turn
    if (joined && attached && !e.agentId && !e.isAborted && e.answer.trim()) {
      if (tag) report($, { kind: 'reply', text: e.answer })
      else await api($, attached, '/api/show', { kind: 'reply', title: 'Tatty', body: e.answer }).catch(() => undefined)
    }
    return done
  })

  on('session.end', async ($, e, next) => {
    if (joined && attached) await api($, attached, '/api/bye', {}).catch(() => undefined)
    return next(e)
  })
}
