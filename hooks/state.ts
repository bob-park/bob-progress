import type { Activity, AgentRun, Main, Plan, PlanState, S, Sp, Task } from '../types'
import type { Ev } from './ev'
import { filesOf, isPlanPath, keepCompleted, ledgerOwns, ledgerPath, logOf, parsePlan, startedOf } from './plan'
import { addExtra, EMPTY_SP, extraOf, isSpecPath, pathFrom, reach, roleOf, sizeUp, stageOf, taskNOf, verdictOf } from './superpowers'

// in the contract, which must be self-contained
export type { PlanState, S } from '../types'
export type Effect = { kind: 'warn'; toolId: string; text: string }
export type View = { main: Main; sp: Sp; spTasks: Task[]; shown: Task[]; runs: AgentRun[]; skills: string[]; activity: Activity[]; busy: boolean }

const MAX_AGENTS = 50
const MAX_ACTIVITY = 10
const MAX_SKILLS = 30

export const DEFAULT_MAIN: Main = { model: '', effort: '', mode: '', steps: 0, isRunning: false, pct: null, tokens: null, window: 0, compactions: 0, costUsd: null, limits: [], doneAt: null }
export const INIT: S = { main: DEFAULT_MAIN, todos: {}, agents: {}, skills: [], activity: [], sp: EMPTY_SP, plan: { path: '', text: '', tasks: [], warned: false } }

/** An agent saved before `status` existed (0.6, kept across a hot reload) reads from its end time */
export const withStatus = (r: AgentRun): AgentRun => (r.status ? r : { ...r, status: r.endedAt === undefined ? 'running' : 'done' })
export const live = (r: AgentRun) => ['running', 'waiting'].includes(withStatus(r).status)
// the oldest ended agents go first; running ones always stay
export const trimAgents = (all: Record<string, AgentRun>) => {
  const ended = Object.entries(all).filter(([, r]) => !live(r)).sort(([, a], [, b]) => a.startedAt - b.startedAt)
  const drop = new Set(ended.slice(0, Math.max(0, Object.keys(all).length - MAX_AGENTS)).map(([id]) => id))
  return Object.fromEntries(Object.entries(all).filter(([id]) => !drop.has(id)))
}
/** Appends a row with the next id after the kept rows: ids outlive a hot reload, a module counter would not */
export const pushActivity = (all: Activity[], row: Omit<Activity, 'id'>) => {
  const id = Math.max(0, ...all.map(a => a.id)) + 1
  return { id, list: [...all, { ...row, id }].slice(-MAX_ACTIVITY) }
}
// `Bash · Run tests`, `Read · plan.ts`: the tool and the most telling input it has
export const activityOf = (e: { tool: string; description?: unknown; file_path?: unknown; pattern?: unknown; command?: unknown }) => {
  const what = [e.description, e.file_path, e.pattern, e.command].find(x => typeof x === 'string' && x) as string | undefined
  return what ? `${e.tool} · ${what.slice(what.lastIndexOf('/') + 1)}` : e.tool
}

// a superpowers plan has an SDD ledger beside it; a plan-mode plan has none
export const isSpPlan = (p: Plan | undefined) => !!p?.path && ledgerPath(p.path) !== null
export const spTasks = (p: Plan | undefined) => (isSpPlan(p) ? p!.tasks : [])
// TASKS: todos win, unless all are done and a plan-mode plan still has open work
export const shownTasks = (todos: Task[], p: Plan | undefined) => {
  const pm = isSpPlan(p) ? [] : (p?.tasks ?? [])
  const planOpen = pm.some(t => t.status !== 'completed')
  return todos.some(t => t.status !== 'completed') || (todos.length > 0 && !planOpen) ? todos : pm
}

// a quote, a separator or redirect, or a bare word
const TOKEN = /'([^']*)'|"([^"]*)"|(&&|\|\|?|;|\n|\d*>>?&?|&>>?)|([^\s'";&|<>]+)/g
/** The command without heredoc bodies: their text is data, not redirects. The `<<` line itself stays */
const withoutHeredocs = (command: string) => {
  const out: string[] = []
  let tag: string | undefined
  for (const line of command.split('\n')) {
    if (tag !== undefined) {
      if (line.trim() === tag) tag = undefined
      continue
    }
    out.push(line)
    tag = /(?<!<)<<-?\s*['"]?(\w+)['"]?/.exec(line)?.[1]
  }
  return out.join('\n')
}
/** The files a Bash call changed: the engine's `bashEditDiff`, else `sed -i`, `>`, `>>` and `tee` targets in the command */
export const editedOf = (command: string, result: unknown): string[] => {
  const changed = (result as { bashEditDiff?: { changedFiles?: unknown } } | null | undefined)?.bashEditDiff?.changedFiles
  if (Array.isArray(changed) && changed.every(f => typeof f === 'string')) return changed
  const out: string[] = []
  let words: string[] = []
  let redirect: string | undefined
  const flush = () => {
    const [cmd, ...args] = words
    words = []
    if (cmd === 'tee') out.push(...args.filter(a => !a.startsWith('-')))
    if (cmd !== 'sed' || !args.some(a => /^(-i|--in-place)/.test(a))) return
    const pos: string[] = []
    let script = false
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!
      if (a === '-i' && args[i + 1] === '') i++ // BSD's `-i ''`: no backup suffix
      else if (a === '-e' || a === '-f') (script = true), i++
      else if (!a.startsWith('-')) pos.push(a)
    }
    // without -e the first word is the script
    out.push(...(script ? pos : pos.slice(1)))
  }
  for (const [, sq, dq, op, w] of withoutHeredocs(command).matchAll(TOKEN)) {
    if (op !== undefined) {
      if (/^(&&|\|\|?|;|\n)$/.test(op)) flush()
      else redirect = op
      continue
    }
    const word = sq ?? dq ?? w!
    // `2>`, `&>` and `>&` don't write a file of the work
    if (redirect === undefined) words.push(word)
    else if (redirect === '>' || redirect === '>>') out.push(word)
    redirect = undefined
  }
  flush()
  // `"$W/progress.md"`: a variable is no path to match
  return out.filter(f => f && f !== '/dev/null' && !f.includes('$'))
}

export const WARN =
  "bob-progress: this edit isn't tied to a plan task. Before working on a task, run `task-start <plan> <N>` (executing-plans) or ledger `Task <N>: dispatched` (subagent-driven-development)."

/** A main-loop call that changed files: Edit/Write/NotebookEdit, or Bash */
export const isEdit = (ev: Ev): ev is Extract<Ev, { t: 'tool.end' }> => ev.t === 'tool.end' && !ev.agentId && ev.ok && ev.edited.length > 0

/** The plan's tasks running now */
export const currentOf = (p: PlanState) => p.tasks.filter(t => t.status === 'in_progress').map(t => t.n ?? '')

const allDone = (list: Task[]) => list.length > 0 && list.every(t => t.status === 'completed')
// SDD and executing-plans review the whole branch only once every task is done; review skills load mid-plan too
const reviewReady = (p: Plan) => !isSpPlan(p) || allDone(p.tasks)
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const isOpen = (p: PlanState, n: string | undefined) => !!n && p.tasks.some(t => t.n === n && t.status !== 'completed')
// rules 1–3: a dispatch, a task-start or an edit names the task, not just "the first open one"
export const tied = (p: PlanState) => logOf(p.ledger, 'dispatched').some(n => isOpen(p, n)) || isOpen(p, p.started) || isOpen(p, p.edited)
// `/abs/repo/hooks/a.ts` is `hooks/a.ts`: paths match by trailing segments
const samePath = (a: string, b: string) => {
  const [x, y] = [a, b].map(p => p.replace(/^\.\//, ''))
  return x === y || x!.endsWith(`/${y}`) || y!.endsWith(`/${x}`)
}
// the plan, a spec, or anything in the superpowers workspace (ledger, briefs), relative or absolute
export const isWorkflowFile = (path: string) => isPlanPath(path) || isSpecPath(path) || /(^|\/)\.superpowers\//.test(path)

// same plan: done stays done
const reparse = (p: PlanState): PlanState => (p.text ? { ...p, tasks: keepCompleted(p.tasks, parsePlan(p.text, p.ledger, p.started, p.edited)) } : p)

/** Rule 3: the lowest open task listing an edited file; an unlisted file leaves it alone */
const editedTask = (p: PlanState, edited: string[]) => {
  const files = filesOf(p.text)
  return p.tasks.find(t => isOpen(p, t.n) && files[t.n!]?.some(f => edited.some(e => samePath(e, f))))?.n
}

const planAfter = (s: S, ev: Extract<Ev, { t: 'tool.end' }>): S => {
  let { plan, sp } = s
  const { input } = ev
  const path = ev.planFile ?? (['Write', 'Edit', 'Read'].includes(ev.tool) && input.file_path && isPlanPath(input.file_path) ? input.file_path : undefined)
  if (path) {
    const fresh = !plan.path || base(plan.path) !== base(path)
    plan = fresh ? { path, text: '', tasks: [], warned: false } : { ...plan, path }
    // a superpowers plan reaches the plan stage; one already reached is only re-read
    if (!ev.planFile && ledgerPath(path) && (fresh || !sp.stages.includes('plan'))) sp = reach(sp, 'plan', ev.at)
  }
  if ((ev.tool === 'Write' || ev.tool === 'Edit') && input.file_path && isSpecPath(input.file_path)) sp = reach(sp, 'spec', ev.at)
  const started = ev.tool === 'Bash' && plan.path ? startedOf(input.command ?? '', plan.path) : undefined
  if (started) plan = reparse({ ...plan, started })
  const edited = isEdit(ev) ? editedTask(plan, ev.edited) : undefined
  if (edited) plan = reparse({ ...plan, edited })
  return { ...s, plan, sp }
}

const fileAfter = (s: S, ev: Extract<Ev, { t: 'file' }>): S => {
  const { plan } = s
  if (plan.path && ev.path === ledgerPath(plan.path))
    return { ...s, plan: reparse({ ...plan, ledger: ledgerOwns(plan.path, ev.text) ? ev.text : undefined }) }
  // the same plan maybe read from the main checkout
  if (isPlanPath(ev.path) && (!plan.path || base(plan.path) === base(ev.path))) return { ...s, plan: reparse({ ...plan, path: ev.path, text: ev.text }) }
  return s
}

// the moment each list became all done; cleared once something is open again
const stampDone = (s: S, at: number): S => {
  const tasksDone = allDone(shownTasks(Object.values(s.todos), s.plan))
  const planDone = allDone(spTasks(s.plan))
  if (tasksDone !== (s.main.doneAt !== null)) s = { ...s, main: { ...s.main, doneAt: tasksDone ? at : null } }
  if (planDone !== (s.sp.doneAt !== null)) s = { ...s, sp: { ...s.sp, doneAt: planDone ? at : null } }
  return s
}

const todosAfter = (todos: Record<string, Task>, ev: Extract<Ev, { t: 'tool.end' }>): Record<string, Task> => {
  const { input } = ev
  if (ev.tool === 'TodoWrite' && input.todos)
    // TodoWrite replaces the whole list
    return Object.fromEntries(input.todos.map((t, i) => [`todo:${i}`, { status: t.status, label: t.activeForm || t.content }]))
  if (ev.tool === 'TaskCreate' && ev.createdTaskId)
    return { ...todos, [ev.createdTaskId]: { status: 'pending', label: input.activeForm || input.subject || '', n: ev.createdTaskId } }
  if (ev.tool === 'TaskUpdate' && input.taskId) {
    const { [input.taskId]: prev, ...rest } = todos
    if (input.status === 'deleted' || !prev) return rest
    const status = (input.status as Task['status'] | undefined) ?? prev.status
    return { ...rest, [input.taskId]: { ...prev, status, label: input.activeForm || input.subject || prev.label } }
  }
  return todos
}

export const step = (s0: S, ev: Ev): { s: S; effects: Effect[] } => {
  let s = stampDone(next(s0, ev), ev.at)
  const p = s.plan
  // a gap ends once rules 1–3 name a task again
  if (p.warned && tied(p)) s = { ...s, plan: { ...p, warned: false } }
  const gap =
    isEdit(ev) && s.sp.current === 'execute' && isSpPlan(p) && p.tasks.some(t => t.status !== 'completed') && !tied(p) && ev.edited.some(f => !isWorkflowFile(f))
  if (!gap || p.warned) return { s, effects: [] }
  return { s: { ...s, plan: { ...p, warned: true } }, effects: [{ kind: 'warn', toolId: ev.id, text: WARN }] }
}

const next = (s: S, ev: Ev): S => {
  const main = (patch: Partial<Main>): S => ({ ...s, main: { ...s.main, ...patch } })
  const agent = (id: string, patch: (r: AgentRun) => AgentRun): S => {
    const r = s.agents[id]
    return r ? { ...s, agents: { ...s.agents, [id]: patch(r) } } : s
  }
  switch (ev.t) {
    case 'turn.start':
      return ev.agentId ? s : main({ isRunning: true })
    case 'turn.end': {
      if (!ev.agentId) {
        // brainstorming says out loud which path it takes
        const path = pathFrom(ev.answer)
        return { ...main({ isRunning: false }), ...(path && s.sp.current === 'brainstorm' ? { sp: { ...s.sp, path: sizeUp(s.sp.path, path) } } : {}) }
      }
      // an agent waiting on its own background work ends its turn but isn't done
      const status = ev.waiting ? 'waiting' : ev.failed ? 'failed' : 'done'
      return agent(ev.agentId, r => {
        const verdict = r.role === 'review' && !ev.waiting ? verdictOf(ev.answer) : undefined
        return { ...r, status, ...(ev.waiting ? {} : { endedAt: ev.at }), ...(verdict ? { verdict } : {}) }
      })
    }
    case 'step':
      if (!ev.agentId) return main({ model: ev.model, effort: ev.effort ?? s.main.effort, steps: s.main.steps + 1 })
      // a step after its end: the agent resumed once its background work came back
      return agent(ev.agentId, ({ endedAt: _, ...r }) => ({ ...r, model: ev.model, status: 'running' }))
    case 'mode':
      return main({ mode: ev.mode })
    case 'usage':
      return main({ pct: ev.pct, tokens: ev.tokens, window: ev.window, costUsd: ev.costUsd, limits: ev.limits })
    case 'compact':
      return main({ compactions: s.main.compactions + 1 })
    case 'agent.spawn': {
      // next after the highest still listed: one left running keeps its number
      const n = Math.max(0, ...Object.values(s.agents).map(r => r.n)) + 1
      // while superpowers runs (until it finishes), its implementers and reviewers get a role
      const role = s.sp.stages.length && s.sp.current !== 'finish' ? roleOf(ev.description) : undefined
      // the description alone: prompts quote plan text, Task numbers included
      const taskN = role ? taskNOf(ev.description) : undefined
      const run: AgentRun = { n, label: ev.description || ev.subagentType, model: ev.model, startedAt: ev.at, status: 'running', ...(role ? { role } : {}), ...(taskN ? { taskN } : {}) }
      // SDD's whole-branch review has no task: execution is over
      const sp = role === 'review' && !taskN && s.sp.current === 'execute' && reviewReady(s.plan) ? reach(s.sp, 'review', ev.at) : s.sp
      return { ...s, sp, agents: trimAgents({ ...s.agents, [ev.agentId]: run }) }
    }
    case 'skill': {
      // the same skill twice in a row is one entry
      const skills = s.skills.at(-1)?.name === ev.name ? s.skills : [...s.skills, { name: ev.name, at: ev.at }].slice(-MAX_SKILLS)
      const stage = stageOf(ev.name)
      const extra = extraOf(ev.name)
      // a skill a subagent loads never moves the stage
      const sp = stage && !ev.fromSubagent && (stage !== 'review' || reviewReady(s.plan)) ? reach(s.sp, stage, ev.at) : extra ? addExtra(s.sp, extra) : s.sp
      return { ...s, skills, sp }
    }
    case 'file':
      return fileAfter(s, ev)
    case 'tool.start':
      if (ev.agentId) return s
      return { ...s, activity: pushActivity(s.activity, { at: ev.at, label: activityOf({ tool: ev.tool, ...ev.input }), status: 'running', toolId: ev.id }).list }
    case 'tool.end': {
      let activity = s.activity
      if (!ev.agentId) {
        // the row this call started; a call without an id settles the latest running row with its label
        const label = activityOf({ tool: ev.tool, ...ev.input })
        const i = activity.findLastIndex(a => a.status === 'running' && (ev.id ? a.toolId === ev.id : a.label === label))
        if (i >= 0) activity = activity.map((a, j) => (j === i ? { ...a, status: ev.ok ? 'ok' : 'error' } : a))
      }
      const done = { ...s, activity, todos: ev.ok ? todosAfter(s.todos, ev) : s.todos }
      return ev.ok && !ev.agentId ? planAfter(done, ev) : done
    }
    default:
      return s
  }
}

export const derive = (s: S, _now: number): View => {
  const runs = Object.values(s.agents).map(withStatus)
  return {
    main: s.main,
    sp: s.sp,
    spTasks: spTasks(s.plan),
    shown: shownTasks(Object.values(s.todos), s.plan),
    runs,
    skills: s.skills.map(k => k.name),
    activity: s.activity,
    // a background agent keeps the session working after the main turn ends
    busy: s.main.isRunning || runs.some(live),
  }
}
