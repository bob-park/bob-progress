import type { Task } from '../types'

const TASK_HEADING = /^###\s+Task\s+(\d+[a-zA-Z]?):\s*(.+)$/
const CHECKBOX = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/
const NUMBERED = /^(\d+)\.\s+(?:\[([ xX])\]\s+)?(.+)$/

const clean = (s: string) => s.replace(/\*\*/g, '').trim()

/** Plan lines outside fenced code blocks: plans quote templates inside fences */
const planLines = (text: string) => {
  let fenced = false
  return text.split(/\r?\n/).filter(l => {
    if (l.trimStart().startsWith('```')) fenced = !fenced
    else return !fenced
    return false
  })
}

// 7.0.1 ledger lines may be list items: `- Task N: complete`, `- Task N: dispatched`
const LEDGER_LINE = /^[\s>*+-]*(?:\*\*)?Task\s+(\d+[a-z]?):\s*(complete(?=\s*(?:[(*.]|$))|dispatched\b)/gim
/** The task numbers a ledger logs as complete or dispatched */
export const logOf = (ledger: string | undefined, word: 'complete' | 'dispatched') =>
  [...(ledger ?? '').matchAll(LEDGER_LINE)].filter(m => m[2]!.toLowerCase() === word).map(m => m[1]!.toLowerCase())

/** Each task's `**Files:**` paths (backticks on `Create:`/`Modify:`/`Test:` lines), `:123-145` dropped */
export const filesOf = (text: string) => {
  const files: Record<string, string[]> = {}
  let n: string | undefined
  for (const line of planLines(text)) {
    const h = TASK_HEADING.exec(line)
    if (h) n = h[1]!.toLowerCase()
    else if (n && /^[\s>*+-]*(?:\*\*)?(?:Create|Modify|Test)(?:\*\*)?:/.test(line))
      // a backtick without `.` or `/` names a type or symbol, not a file
      files[n] = [...(files[n] ?? []), ...[...line.matchAll(/`([^`]+)`/g)].map(m => m[1]!.replace(/:\d+(-\d+)?$/, '')).filter(p => /[./]/.test(p))]
  }
  return files
}

export const isPlanPath = (p: string) => /\/(docs\/superpowers\/plans|\.claude\/plans)\/[^/]+\.md$/.test(p)

/** The SDD ledger beside a superpowers plan; null for any other plan */
export const ledgerPath = (planPath: string) => {
  const m = /^(.*)\/docs\/superpowers\/plans\/([^/]+)\.md$/.exec(planPath)
  return m ? `${m[1]}/.superpowers/sdd/${m[2]}/progress.md` : null
}

/** A ledger's first line names the plan it tracks */
export const ledgerOwns = (planPath: string, ledger: string) =>
  (ledger.split(/\r?\n/, 1)[0] ?? '').includes(planPath.slice(planPath.lastIndexOf('/') + 1))

/** Done items first get their status; the first open one is current once anything has started */
const withCurrent = (items: Array<{ label: string; done: boolean; n?: string }>, started: boolean): Task[] => {
  const current = items.findIndex(i => !i.done)
  return items.map((i, k) => ({
    status: i.done ? 'completed' : started && k === current ? 'in_progress' : 'pending',
    label: i.label,
    ...(i.n ? { n: i.n } : {}),
  }))
}

/** Re-read plan keeps what was done: finishing a branch drops the SDD ledger */
export const keepCompleted = (prev: Task[], next: Task[]): Task[] => {
  const done = new Set(prev.filter(t => t.status === 'completed').map(t => t.label))
  // the ledger already named what runs now (dispatched): keep it, only carry done over
  if (next.some(t => t.status === 'in_progress' && !done.has(t.label))) return next.map(t => (done.has(t.label) ? { ...t, status: 'completed' as const } : t))
  return withCurrent(
    next.map(t => ({ label: t.label, n: t.n, done: t.status === 'completed' || done.has(t.label) })),
    next.some(t => t.status !== 'pending') || next.some(t => done.has(t.label)),
  )
}

/** executing-plans takes each task with `task-start PLAN N`: N, when PLAN is this plan */
export const startedOf = (command: string, planPath: string) => {
  const m = /\btask-start['"]?\s+(\S+)\s+['"]?(\d+[a-zA-Z]?)\b/.exec(command)
  const base = (p: string) => p.replace(/['"]/g, '').slice(p.replace(/['"]/g, '').lastIndexOf('/') + 1)
  return m && base(m[1]!) === base(planPath) ? m[2]!.toLowerCase() : undefined
}

export const parsePlan = (text: string, ledger?: string, started?: string, edited?: string): Task[] => {
  const lines = planLines(text)

  // superpowers: `### Task N:` headings (a task added mid-run reads `3b`), steps beneath
  const tasks: Array<{ n: string; label: string; steps: boolean[] }> = []
  for (const line of lines) {
    const h = TASK_HEADING.exec(line)
    if (h) tasks.push({ n: h[1]!.toLowerCase(), label: clean(h[2]!), steps: [] })
    else {
      const c = CHECKBOX.exec(line)
      if (c) tasks.at(-1)?.steps.push(c[1] !== ' ')
    }
  }
  if (tasks.length > 0) {
    const logged = new Set(logOf(ledger, 'complete'))
    const items = tasks.map(t => ({ label: t.label, n: t.n, done: logged.has(t.n) || (t.steps.length > 0 && t.steps.every(Boolean)) }))
    // a dispatched task still open is what runs now; several when dispatched in parallel
    const open = (n: string) => items.some(i => i.n === n && !i.done)
    const dispatched = logOf(ledger, 'dispatched').filter(open)
    // executing-plans dispatches nothing: the task it last started runs now, else the one a main-loop edit last touched
    const chosen = [started, edited].find(n => n && open(n))
    const running = new Set(dispatched.length > 0 ? dispatched : chosen ? [chosen] : [])
    if (running.size > 0)
      return items.map(i => ({ status: i.done ? 'completed' : running.has(i.n) ? 'in_progress' : 'pending', label: i.label, n: i.n }))
    return withCurrent(items, logged.size > 0 || tasks.some(t => t.steps.some(Boolean)))
  }

  // plan mode: checkboxes, else top-level numbered items (ticked as `1. [x]`)
  const items = lines.map(l => CHECKBOX.exec(l)).filter(m => m !== null).map(m => ({ label: clean(m[2]!), done: m[1] !== ' ' }))
  if (items.length > 0) return withCurrent(items, items.some(i => i.done))
  const numbered = lines.map(l => NUMBERED.exec(l)).filter(m => m !== null).map(m => ({ label: clean(m[3]!), n: m[1]!, done: !!m[2] && m[2] !== ' ' }))
  return withCurrent(numbered, numbered.some(i => i.done))
}
