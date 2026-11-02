import type { TaskStatus } from '../types'

/** The tool input fields the reducer reads */
export type ToolInput = { file_path?: string; command?: string; description?: string; pattern?: string; subject?: string; activeForm?: string; taskId?: string; status?: string; todos?: Array<{ content: string; status: TaskStatus; activeForm?: string }> }

/** What happened in a session: hooks produce these live, a transcript replays them */
export type Ev =
  | { t: 'turn.start'; at: number; agentId?: string }
  | { t: 'turn.end'; at: number; agentId?: string; answer: string; failed: boolean; waiting: boolean }
  | { t: 'step'; at: number; agentId?: string; model: string; effort?: string }
  | { t: 'tool.start'; at: number; agentId?: string; id: string; tool: string; input: ToolInput }
  | { t: 'tool.end'; at: number; agentId?: string; id: string; tool: string; input: ToolInput; ok: boolean; edited: string[]; output?: string; createdTaskId?: string; planFile?: string }
  | { t: 'file'; at: number; path: string; text: string }
  | { t: 'skill'; at: number; name: string; fromSubagent: boolean }
  | { t: 'agent.spawn'; at: number; agentId: string; description: string; subagentType: string; model: string }
  | { t: 'usage'; at: number; pct: number | null; tokens: number | null; window: number; costUsd: number | null; limits: Array<{ kind: string; pct: number }> }
  | { t: 'compact'; at: number }
  | { t: 'mode'; at: number; mode: string }
