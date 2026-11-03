/**
 * NEXT-17: where the studio's phone line sends a call for the AI to answer. OpenAI receives calls
 * over SIP at its project's own address and tells SALEANE through a signed webhook.
 */
export type PhoneLine = {
  /** OpenAI's SIP address for the project, such as sip:proj_abc@sip.api.openai.com:5061. */
  sipUri: string
  /** The project's webhook secret, which signs each call OpenAI tells SALEANE about. */
  webhookSecret: string
}

/**
 * Reads where calls go from the environment. Unset means the AI answers no calls. Naming one of
 * the two without the other, or either without talking switched on, stops the server rather than
 * quietly going without.
 */
export function phoneFromEnv(
  env: Record<string, string | undefined> = process.env,
): PhoneLine | null {
  const project = env.OPENAI_PROJECT_ID?.trim()
  const secret = env.OPENAI_WEBHOOK_SECRET?.trim()
  if (!project && !secret) return null
  if (!project || !secret)
    throw new Error('Set both OPENAI_PROJECT_ID and OPENAI_WEBHOOK_SECRET to answer phone calls.')
  if (!/^proj_[A-Za-z0-9]{1,100}$/.test(project))
    throw new Error('OPENAI_PROJECT_ID is the project id from OpenAI, starting proj_.')
  if (env.SALEANE_VOICE_PROVIDER?.trim() !== 'openai')
    throw new Error(
      'Answering phone calls needs talking switched on: SALEANE_VOICE_PROVIDER=openai.',
    )
  return { sipUri: `sip:${project}@sip.api.openai.com:5061`, webhookSecret: secret }
}
