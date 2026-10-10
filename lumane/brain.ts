/**
 * The brain is the AI model that reads a request and chooses skills. Lumane talks to it through
 * this small interface so the supplier can be swapped. The test-mode brain sends nothing and costs
 * nothing; a real supplier (see `claude.ts`) sits behind the same interface and is used only when
 * the app is given its key.
 */
export type ToolSpec = { name: string; description: string; inputSchema: Record<string, unknown> }

export type ToolCall = { id: string; name: string; input: unknown }

export type BrainMessage =
  | { role: 'user'; text: string }
  | {
      role: 'assistant'
      text?: string
      calls: ToolCall[]
      /** The supplier's own record of this reply, sent back to it unchanged within the turn. */
      raw?: unknown
    }
  | { role: 'tool'; callId: string; result: string; isError?: boolean }

export type BrainRequest = {
  instructions: string
  /**
   * Facts for this request only, such as today's date. Kept apart from the standing instructions
   * so a supplier can reuse the unchanging part from one request to the next.
   */
  context?: string
  messages: BrainMessage[]
  tools: ToolSpec[]
}

export type BrainReply = {
  text?: string
  calls: ToolCall[]
  /** What this reply cost, in minor units. */
  costMinor: number
  /**
   * The supplier's own record of the reply, when it must have it back exactly as sent, as Claude
   * needs its thinking returned on the call after a skill is used.
   */
  raw?: unknown
}

export interface Brain {
  name: string
  /** True when it calls a real AI supplier, which costs money and sends the request away. */
  live?: boolean
  respond(request: BrainRequest): Promise<BrainReply>
}

/**
 * Why a brain could not answer. `costMinor` is what the attempt may still have cost: nothing for
 * a refusal, and a careful estimate when the connection dropped after the request went out.
 */
export class BrainError extends Error {
  constructor(
    readonly kind: 'unreachable' | 'busy' | 'refused' | 'failed',
    message: string,
    readonly costMinor = 0,
  ) {
    super(message)
    this.name = 'BrainError'
  }
}

/**
 * A brain that follows a script instead of calling an AI supplier. It sends nothing anywhere and
 * costs nothing, for tests and the fictional demo studios.
 */
export function scriptedBrain(
  script: (
    request: BrainRequest,
    step: number,
  ) => Omit<BrainReply, 'costMinor'> & { costMinor?: number },
): Brain {
  let step = 0
  return {
    name: 'test-mode',
    async respond(request) {
      const reply = script(request, step++)
      return { costMinor: 0, ...reply }
    },
  }
}
