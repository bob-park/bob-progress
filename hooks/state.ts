import type { Activity, AgentRun, Main, Plan, SkillUse, Sp, Task } from '../types'
import type { Ev } from './ev'
import { ledgerPath } from './plan'
import { EMPTY_SP } from './superpowers'

/** `text`: the plan file as last read; `ledger`: its SDD ledger; `edited`: the last plan task a code edit touched */
export type PlanState = { path: string; text: string; ledger?: string; tasks: Task[]; started?: string; edited?: string; warned: boolean }
export type S = { main: Main; todos: Record<string, Task>; agents: Record<string, AgentRun>; skills: SkillUse[]; activity: Activity[]; sp: Sp; plan: PlanState }
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

export const step = (s: S, ev: Ev): { s: S; effects: Effect[] } => ({ s: next(s, ev), effects: [] })

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
      if (!ev.agentId) return main({ isRunning: false })
      // an agent waiting on its own background work ends its turn but isn't done
      const status = ev.waiting ? 'waiting' : ev.failed ? 'failed' : 'done'
      return agent(ev.agentId, r => ({ ...r, status, ...(ev.waiting ? {} : { endedAt: ev.at }) }))
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
      const run: AgentRun = { n, label: ev.description || ev.subagentType, model: ev.model, startedAt: ev.at, status: 'running' }
      return { ...s, agents: trimAgents({ ...s.agents, [ev.agentId]: run }) }
    }
    case 'skill':
      // the same skill twice in a row is one entry
      return s.skills.at(-1)?.name === ev.name ? s : { ...s, skills: [...s.skills, { name: ev.name, at: ev.at }].slice(-MAX_SKILLS) }
    case 'tool.start':
      if (ev.agentId) return s
      return { ...s, activity: pushActivity(s.activity, { at: ev.at, label: activityOf({ tool: ev.tool, ...ev.input }), status: 'running' }).list }
    case 'tool.end': {
      let activity = s.activity
      if (!ev.agentId) {
        // ponytail: settles the latest running row with this label; key rows by tool id if parallel identical calls show the wrong status
        const label = activityOf({ tool: ev.tool, ...ev.input })
        const i = activity.findLastIndex(a => a.status === 'running' && a.label === label)
        if (i >= 0) activity = activity.map((a, j) => (j === i ? { ...a, status: ev.ok ? 'ok' : 'error' } : a))
      }
      return { ...s, activity, todos: ev.ok ? todosAfter(s.todos, ev) : s.todos }
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
