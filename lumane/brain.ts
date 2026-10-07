/**
 * The brain is the AI model that reads a request and chooses skills. Lumane talks to it through
 * this small interface so the supplier can be swapped. Only the test-mode brain ships here: real
 * suppliers are added behind the same interface and stay unconfigured until the owner turns them on.
 */
export type ToolSpec = { name: string; description: string; inputSchema: Record<string, unknown> }

export type ToolCall = { id: string; name: string; input: unknown }

export type BrainMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text?: string; calls: ToolCall[] }
  | { role: 'tool'; callId: string; result: string; isError?: boolean }

export type BrainRequest = { instructions: string; messages: BrainMessage[]; tools: ToolSpec[] }

export type BrainReply = {
  text?: string
  calls: ToolCall[]
  /** What this reply cost, in minor units. */
  costMinor: number
}

export interface Brain {
  name: string
  respond(request: BrainRequest): Promise<BrainReply>
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
