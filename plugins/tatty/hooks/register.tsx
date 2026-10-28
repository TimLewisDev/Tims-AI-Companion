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
let joined = false // this session works with Tatty (tagged, TATTY_JOIN, or /tatty open|attach)
let lastRoster = '' // the subagent roster last reported (see reportAgents)
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
    // the Claude session id goes with every post: it tells Tatty which feature its words are about
    body: body === undefined ? undefined : JSON.stringify({ session, ...body, ...(tag ? { tag } : {}) }),
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
function report($: EngineInterface, body: Record<string, unknown>, path = '/api/activity') {
  if (!tag || !attached) return
  void api($, attached, path, body).catch(() => undefined)
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

// reportAgents: the session's subagents and where each stands, when that changed.
// A session whose main turn has ended can still be waiting on background subagents,
// and only this says so. It reads the engine's roster rather than counting events,
// so a subagent that was killed, or ended without a word, leaves the list too.
async function reportAgents($: EngineInterface) {
  if (!tag || !attached) return
  try {
    const agents = (await $.agent.list()).map(a => ({
      id: a.id, type: a.type, description: String(a.description || '').slice(0, 120), status: a.status,
    }))
    const key = JSON.stringify(agents)
    if (key === lastRoster) return
    lastRoster = key
    report($, { kind: 'agents', agents })
  } catch {
    /* the status then goes on what it knew */
  }
}

// The few words that say what a tool call is about.
function about(e: any): string {
  const v = e.description || e.file_path || e.notebook_path || e.pattern || e.url || e.skill || e.query || e.command || e.prompt || ''
  return String(v).replace(/\s+/g, ' ').slice(0, 300)
}

// The most a reported change may carry. The server refuses a body over 1 MiB and
// a refused post is lost without a trace, so the lines are cut well below that.
// The total is counted in bytes of the JSON the post carries, not in characters:
// CJK text is 3 bytes a character and quotes, backslashes and tabs are doubled.
const CHANGE_LINES = 2000
const CHANGE_LINE_CHARS = 1000
const CHANGE_TOTAL_BYTES = 400000

// What a line takes in the JSON body: its UTF-8 bytes, with the escapes, quotes and comma.
function jsonBytes(s: string): number {
  let n = 4
  for (const ch of s) {
    const c = ch.codePointAt(0) as number
    if (c >= 0xd800 && c <= 0xdfff) n += 6 // a lone surrogate is written as \udXXX
    else if (c < 0x20) n += 6
    else if (c === 0x22 || c === 0x5c) n += 2
    else n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4
  }
  return n
}

// reportChange: a file edit a subagent made, as the engine's patch hunks, for the
// feature page. Only a finished edit counts: a denied or failed one, or one held
// for approval, left the file as it was.
function reportChange($: EngineInterface, e: any, done: any) {
  if ('deny' in done || done.isError) return
  const r = done.result
  if (!r || r.staged) return
  const type = e.tool === 'Write' && r.type === 'create' ? 'create' : 'update'
  let hunks: { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }[] =
    Array.isArray(r.structuredPatch) ? r.structuredPatch : []
  // a new file has no patch to show, so its whole content is the addition
  if (e.tool === 'Write' && type === 'create' && !hunks.length && typeof e.content === 'string') {
    // a file that ends with a newline has no line after it; an empty file has no lines at all
    const parts: string[] = e.content.split('\n')
    if (parts[parts.length - 1] === '') parts.pop()
    if (parts.length) {
      const lines = parts.map(l => '+' + l)
      hunks = [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: lines.length, lines }]
    }
  }
  let left = CHANGE_LINES
  let bytes = 0
  let truncated = false
  const kept: typeof hunks = []
  for (const h of hunks) {
    const lines: string[] = []
    for (const raw of Array.isArray(h.lines) ? h.lines : []) {
      if (left <= 0 || bytes >= CHANGE_TOTAL_BYTES) {
        truncated = true
        break
      }
      const line = String(raw)
      const cut = line.length > CHANGE_LINE_CHARS ? line.slice(0, CHANGE_LINE_CHARS) : line
      if (cut !== line) truncated = true
      lines.push(cut)
      left--
      bytes += jsonBytes(cut)
    }
    if (lines.length) kept.push({ ...h, lines })
    if (truncated && (left <= 0 || bytes >= CHANGE_TOTAL_BYTES)) break
  }
  if (!kept.length) return
  report($, { tool: String(e.tool), file: String(e.file_path), type, hunks: kept, truncated, agent: String(e.agentId) }, '/api/change')
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

// The /tatty command: open (the default), attach, detach, close, status, install or uninstall.
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
  if (verb === 'install') {
    // Builds the launcher the first time, which takes about a minute.
    const r = await tattySh($, ['install'])
    const said = (r.stderr || r.stdout).trim()
    if (r.exitCode === 3) return { text: 'No Python 3.8+ found, so Tatty is not available here.' }
    return { text: r.exitCode === 0 ? said : `Tatty was not installed: ${said}` }
  }
  if (verb === 'uninstall') {
    const r = await tattySh($, ['uninstall'])
    return { text: (r.stderr || r.stdout).trim() }
  }
  return { text: 'usage: /tatty [open | attach | detach | close | status | install | uninstall]' }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    session = await $.session.id()
    tag = (await $.env.get('TATTY_SESSION')) || ''
    // TATTY_JOIN: Tatty's own session (the Desktop app starts it): it works with
    // Tatty like a /tatty attach'd one, on the main feed rather than a feature's.
    joined = Boolean(tag) || (await $.env.get('TATTY_JOIN')) === '1'
    Object.assign(spent, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
    await $.command.register({
      name: 'tatty',
      description: 'Open Tatty, or have this session work with it (attach / detach), close it, or put it on the Desktop (install)',
      argumentHint: '[open | attach | detach | close | status | install | uninstall]',
    })
    lastRoster = ''
    if (joined) await attach($)
    $.clock.every(POLL_MS, () => {
      void pollInbox($)
      void reportAgents($)
    })
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
    if (!tag) return next(e)
    if (e.agentId) {
      // a subagent's own tools stay off the tool rows; only the files it changes are reported
      if (e.tool !== 'Edit' && e.tool !== 'Write') return next(e)
      const changed = await next(e)
      try {
        reportChange($, e, changed)
      } catch {
        /* reporting never fails the tool that already ran */
      }
      return changed
    }
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

  // A started session: its own turns begin and end (the main loop's say whether it
  // is working; a subagent's start or end is a change of the roster, sent at once).
  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    if (tag) {
      if (!e.agentId) report($, { kind: 'turn', state: 'start' })
      else void reportAgents($)
    }
    return started
  }).catch(($, e, next) => next(e))

  // Mirror the session's answers into Tatty, so it reads like a chat. A started
  // session's go to its feature page instead of the main feed.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (tag) {
      if (!e.agentId) report($, { kind: 'turn', state: 'end' })
      else void reportAgents($)
    }
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
