import type { Ev, ToolInput } from '../hooks/ev'
import { isPlanPath, ledgerPath } from '../hooks/plan'
import { editedOf } from '../hooks/state'
import { skillName } from '../hooks/superpowers'

type Block = { type?: string; id?: string; name?: string; input?: Record<string, unknown>; tool_use_id?: string; is_error?: boolean }
type Rec = { type?: string; timestamp?: string; cwd?: string; isSidechain?: boolean; agentId?: string; message?: { content?: unknown }; toolUseResult?: unknown }
type Result = { agentId?: string; resolvedModel?: string; originalFile?: string; stdout?: string; file?: { content?: string; numLines?: number; totalLines?: number } }

const base = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const resolve = (cwd: string, p: string) => (p.startsWith('/') ? p : `${cwd}/${p.replace(/^\.\//, '')}`)
const blocks = (r: Rec): Block[] => (Array.isArray(r.message?.content) ? r.message.content.filter((b): b is Block => !!b && typeof b === 'object') : [])
const PLAN_IN = /(?:[\w.~/-]*\/)?(?:docs\/superpowers\/plans|\.claude\/plans)\/[^\s'"`/;|&)<>]+\.md/g
const LEDGER_DIR = /\.superpowers\/sdd\/([^/\s'"]+)\/progress\.md/
const TARGET = /(>>?)\s*['"]?([^\s'"]*progress\.md)['"]?/

/** What a Bash command writes into a `progress.md`: echo/printf bodies and heredocs; `append` false for `>` */
const ledgerWrites = (command: string) => {
  const out: Array<{ target: string; append: boolean; body: string }> = []
  const lines = command.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const doc = /<<-?\s*['"]?(\w+)['"]?/.exec(line)
    if (doc) {
      const end = lines.findIndex((l, j) => j > i && l.trim() === doc[1])
      const body = lines.slice(i + 1, end < 0 ? undefined : end).join('\n')
      const t = TARGET.exec(line)
      if (t) out.push({ target: t[2]!, append: t[1] === '>>', body: `${body}\n` })
      i = end < 0 ? lines.length : end
      continue
    }
    for (const part of line.split(/&&|\|\||;/)) {
      const m = /^\s*(echo|printf)\s+(.*?)\s*(>>?)\s*['"]?([^\s'"]*progress\.md)['"]?\s*$/.exec(part)
      if (!m) continue
      const args = [...m[2]!.matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g)].map(a => a[1] ?? a[2] ?? a[3]!).filter(a => !/^-[en]+$/.test(a))
      const text = m[1] === 'printf' && args[0]?.includes('%s') ? args.slice(1).join('\n') : m[1] === 'printf' ? (args[0] ?? '') : args.join(' ')
      out.push({ target: m[4]!, append: m[3] === '>>', body: `${text.replace(/\\n/g, '\n').replace(/\n$/, '')}\n` })
    }
  }
  return out
}

/**
 * A transcript (and its subagents' files) as the events the live hooks emit. After each main-loop call the
 * active plan and its ledger come as `file` events, as the live hook re-reads them; their text is what the
 * transcript shows, or the disk when it shows none.
 */
export const fromTranscript = (
  lines: string[],
  readSubagent: (agentId: string) => string[] | undefined,
  readDisk: (absPath: string) => string | undefined,
): { evs: Ev[]; skipped?: string } => {
  const parse = (ls: string[]) =>
    ls.flatMap(l => {
      try {
        const r = JSON.parse(l) as Rec
        return r && (r.type === 'assistant' || r.type === 'user') ? [r] : []
      } catch {
        return []
      }
    })
  // every agent's records, merged in time order
  const recs = parse(lines)
  const agentOf: Record<string, string> = {}
  for (let i = 0; i < recs.length; i++)
    for (const b of blocks(recs[i]!)) {
      const id = (recs[i]!.toolUseResult as Result | undefined)?.agentId
      if (b.type === 'tool_result' && b.tool_use_id && typeof id === 'string' && !agentOf[b.tool_use_id]) {
        agentOf[b.tool_use_id] = id
        recs.push(...parse(readSubagent(id) ?? []).map(r => ({ ...r, isSidechain: true, agentId: id })))
      }
    }
  const at = (r: Rec) => Date.parse(r.timestamp ?? '') || 0
  recs.sort((a, b) => at(a) - at(b))
  const lastOf: Record<string, number> = {}
  recs.forEach((r, i) => r.isSidechain && r.agentId && (lastOf[r.agentId] = i))

  const evs: Ev[] = []
  const calls: Record<string, { tool: string; input: ToolInput & Record<string, unknown> }> = {}
  // per plan basename: its latest path, its text, its ledger
  const paths: Record<string, string> = {}
  const texts: Record<string, string> = {}
  const ledgers: Record<string, string> = {}
  let active: string | undefined

  // a main-loop Write/Edit/Read makes a plan active, as the reducer does; any plan seen first becomes active
  const seePlan = (path: string, agentId: string | undefined, makeActive: boolean) => {
    const k = base(path)
    paths[k] = path
    if (texts[k] === undefined) {
      const text = readDisk(path)
      if (text !== undefined) texts[k] = text
    }
    if (!agentId && (makeActive || active === undefined)) active = k
  }
  const writeLedger = (k: string, body: string, append: boolean) => {
    // the target names the plan; a header written through shell variables can't, so the converter writes its own
    const head = `# SDD ledger — plan: ${paths[k] ?? k}\n`
    const rest = /^#.*ledger/i.test(body) ? body.slice(body.indexOf('\n') + 1) : body
    ledgers[k] = append ? (ledgers[k] ?? head) + body : head + rest
  }

  for (const [i, r] of recs.entries()) {
    const now = at(r)
    const agentId = r.isSidechain ? r.agentId : undefined
    const cwd = r.cwd ?? ''
    for (const b of blocks(r)) {
      if (b.type === 'tool_use' && b.id && b.name) {
        const input = (b.input ?? {}) as ToolInput & Record<string, unknown>
        calls[b.id] = { tool: b.name, input }
        evs.push({ t: 'tool.start', at: now, ...(agentId ? { agentId } : {}), id: b.id, tool: b.name, input })
        if (b.name === 'Skill' && typeof input.skill === 'string') evs.push({ t: 'skill', at: now, name: skillName(input.skill), fromSubagent: !!agentId })
        const spawned = agentOf[b.id]
        if (b.name === 'Agent' && spawned)
          evs.push({ t: 'agent.spawn', at: now, agentId: spawned, description: String(input.description ?? ''), subagentType: String(input.subagent_type ?? ''), model: String(input.model ?? '') })
      }
      if (b.type !== 'tool_result' || !b.tool_use_id || !calls[b.tool_use_id]) continue
      const { tool, input } = calls[b.tool_use_id]!
      const res = (r.toolUseResult && typeof r.toolUseResult === 'object' ? r.toolUseResult : {}) as Result
      const ok = !b.is_error
      const file = typeof input.file_path === 'string' ? resolve(cwd, input.file_path) : ''
      const command = typeof input.command === 'string' ? input.command : ''
      const edited = tool === 'Edit' || tool === 'Write' ? [file] : tool === 'NotebookEdit' ? [String(input.notebook_path ?? '')] : tool === 'Bash' ? editedOf(command, r.toolUseResult) : []
      evs.push({ t: 'tool.end', at: now, ...(agentId ? { agentId } : {}), id: b.tool_use_id, tool, input, ok, edited })

      if (ok) {
        // plan text: a Write's content, a whole Read, an Edit applied to the last known text
        if (file && isPlanPath(file)) {
          const k = base(file)
          seePlan(file, agentId, true)
          if (tool === 'Write' && typeof input.content === 'string') texts[k] = input.content
          if (tool === 'Read' && typeof res.file?.content === 'string' && res.file.numLines === res.file.totalLines) texts[k] = res.file.content
          if (tool === 'Edit') {
            const prior = texts[k] ?? res.originalFile
            const [from, to] = [String(input.old_string ?? ''), String(input.new_string ?? '')]
            if (prior !== undefined && from) texts[k] = input.replace_all ? prior.split(from).join(to) : prior.replace(from, () => to)
          }
        }
        for (const m of command.matchAll(PLAN_IN)) if (!m[0].includes('$')) seePlan(resolve(cwd, m[0]), agentId, false)

        // the ledger: task-done's `ledger:` lines, echo/printf/heredoc into progress.md, a Write or Edit of it
        const own = (target: string) => {
          const dir = LEDGER_DIR.exec(target)?.[1]
          return dir && !target.includes('$') ? `${dir}.md` : active
        }
        const done = /\btask-done['"]?\s+['"]?([^\s'"]+)/.exec(command)
        const logged = (res.stdout ?? '').split('\n').filter(l => l.startsWith('ledger: ')).map(l => `${l.slice(8)}\n`)
        if (done && logged.length) writeLedger(base(done[1]!), logged.join(''), true)
        if (tool === 'Bash') for (const w of ledgerWrites(command)) own(w.target) && writeLedger(own(w.target)!, w.body, w.append)
        const k = file.endsWith('/progress.md') ? own(file) : undefined
        if (k && tool === 'Write' && typeof input.content === 'string') writeLedger(k, input.content, false)
        if (k && tool === 'Edit' && ledgers[k] !== undefined) ledgers[k] = ledgers[k].replace(String(input.old_string ?? ''), () => String(input.new_string ?? ''))
      }

      // the live hook re-reads the active plan and its ledger after each main-loop call
      const plan = active && paths[active]
      if (!agentId && plan && texts[active!] !== undefined) {
        evs.push({ t: 'file', at: now, path: plan, text: texts[active!]! })
        const lp = ledgerPath(plan)
        if (lp && ledgers[active!] !== undefined) evs.push({ t: 'file', at: now, path: lp, text: ledgers[active!]! })
      }
    }
    if (agentId && lastOf[agentId] === i) evs.push({ t: 'turn.end', at: now, agentId, answer: '', failed: false, waiting: false })
  }
  return Object.keys(texts).length ? { evs } : { evs, skipped: 'no plan' }
}
