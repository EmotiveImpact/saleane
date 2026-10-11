/**
 * Allowances keep every studio's AI use inside what its plan pays for. Nothing is unlimited:
 * the allowance is checked before every request, and a refused request never reaches the AI
 * supplier, so overuse cannot cost the business anything.
 */
/**
 * A kind of use an app sells, such as typed questions or talking minutes. Each app names its own
 * in its pack; LUMANE counts whatever it is given and knows nothing about what they mean.
 */
export type Meter = string

export type Allowance<M extends Meter = Meter> = {
  /** Monthly amounts for each kind of use. A kind the plan leaves out has none. */
  monthly: Record<M, number>
  /** The most AI spend one account may run up in a day, in minor units (pence or cents). */
  dailySpendCeilingMinor: number
  /**
   * The most AI spend one account may run up in a calendar month, in minor units, so that a
   * studio reaching the daily ceiling every day still cannot cost more than it pays.
   */
  monthlySpendCeilingMinor: number
  /** Requests one person may make in any rolling hour. */
  perPersonHourly: number
  /** The longest single talking session, in seconds. */
  maxTalkSessionSeconds: number
}

export type Usage = {
  /** The calendar month these totals belong to, as YYYY-MM. */
  period: string
  /** How much of each kind has been used. A kind not used yet this month may be missing. */
  used: Partial<Record<Meter, number>>
  /** AI spend by day (YYYY-MM-DD), in minor units. */
  spendByDay: Record<string, number>
  /** Recent request times per person, kept for the hourly limit. */
  recent: Record<string, string[]>
  /**
   * Requests held and not yet settled, each with the time after which it is given back, so a
   * request the app never settled (it stopped mid-request) does not keep its share for the month.
   */
  holds?: { request: UseRequest; until: string }[]
}

export type UseRequest<M extends Meter = Meter> = {
  meter: M
  amount: number
  personId: string
  /** When the request is made, as an ISO instant. */
  at: string
  /** The most this request could cost, in minor units. */
  worstCaseMinor: number
}

export type Refusal = {
  ok: false
  reason: 'allowance' | 'rate' | 'spend'
  /** A plain sentence for the person, never a technical error. */
  message: string
}

const HOUR = 3_600_000

export function emptyUsage(at: string): Usage {
  return { period: at.slice(0, 7), used: {}, spendByDay: {}, recent: {} }
}

/** The usage that applies at `at`: a new month starts from zero. */
export function current(usage: Usage | undefined, at: string): Usage {
  return usage && usage.period === at.slice(0, 7) ? usage : emptyUsage(at)
}

/** How much of one kind has been used in the month `at` falls in: nothing when none is recorded. */
export function usedOf(usage: Usage | undefined, meter: Meter, at: string) {
  return current(usage, at).used[meter] ?? 0
}

/** How much of each kind the allowance names has been used this month, for the usage meter. */
export function usedEach<M extends Meter>(
  allowance: Allowance<M>,
  usage: Usage | undefined,
  at: string,
) {
  const kinds = Object.keys(allowance.monthly) as M[]
  return Object.fromEntries(kinds.map((m) => [m, usedOf(usage, m, at)])) as Record<M, number>
}

/** What is left of one kind this month. A kind the allowance does not name has nothing left. */
export function remaining<M extends Meter>(
  allowance: Allowance<M>,
  usage: Usage | undefined,
  meter: M,
  at: string,
) {
  return Math.max(0, (allowance.monthly[meter] ?? 0) - usedOf(usage, meter, at))
}

/** How much of each monthly amount is used, from 0 to 1, for the usage meter. */
export function share<M extends Meter>(
  allowance: Allowance<M>,
  usage: Usage | undefined,
  at: string,
) {
  const used = usedEach(allowance, usage, at)
  const kinds = Object.keys(allowance.monthly) as M[]
  return Object.fromEntries(
    kinds.map((m) => [m, allowance.monthly[m] ? Math.min(1, used[m] / allowance.monthly[m]) : 1]),
  ) as Record<M, number>
}

export function check<M extends Meter>(
  allowance: Allowance<M>,
  usage: Usage | undefined,
  request: UseRequest<M>,
): { ok: true } | Refusal {
  const now = current(usage, request.at)
  if ((now.used[request.meter] ?? 0) + request.amount > (allowance.monthly[request.meter] ?? 0))
    return {
      ok: false,
      reason: 'allowance',
      message:
        "This month's assistant allowance is used up. It resets on the 1st, or the owner can top up.",
    }
  const since = Date.parse(request.at) - HOUR
  const recent = (now.recent[request.personId] ?? []).filter((t) => Date.parse(t) > since)
  if (recent.length >= allowance.perPersonHourly)
    return {
      ok: false,
      reason: 'rate',
      message: "That's a lot of questions in the last hour. Please try again a little later.",
    }
  const day = request.at.slice(0, 10)
  if ((now.spendByDay[day] ?? 0) + request.worstCaseMinor > allowance.dailySpendCeilingMinor)
    return {
      ok: false,
      reason: 'spend',
      message: "The assistant has reached today's limit. It will be back tomorrow.",
    }
  const month = Object.values(now.spendByDay).reduce((total, spent) => total + spent, 0)
  if (month + request.worstCaseMinor > allowance.monthlySpendCeilingMinor)
    return {
      ok: false,
      reason: 'spend',
      message: "The assistant has reached this month's limit. It will be back on the 1st.",
    }
  return { ok: true }
}

/** Record a finished request and what it actually cost. Returns new usage; never mutates. */
export function record(usage: Usage | undefined, request: UseRequest, costMinor: number): Usage {
  const now = current(usage, request.at)
  const day = request.at.slice(0, 10)
  const since = Date.parse(request.at) - HOUR
  return {
    ...now,
    used: { ...now.used, [request.meter]: (now.used[request.meter] ?? 0) + request.amount },
    spendByDay: { ...now.spendByDay, [day]: (now.spendByDay[day] ?? 0) + Math.max(0, costMinor) },
    recent: {
      ...now.recent,
      [request.personId]: [
        ...(now.recent[request.personId] ?? []).filter((t) => Date.parse(t) > since),
        request.at,
      ],
    },
  }
}

/** How long a request is held before it is given back unsettled, unless the app says longer. */
export const HOLD_SECONDS = 300

/**
 * Holds a request's share before the AI is called: its amount, its worst-case spend and its place
 * in the hourly count. Requests made at the same moment then cannot all pass the checks against
 * the same usage. The hold lasts until `until` (five minutes by default), after which `reclaim`
 * gives it back should it never have been settled. Returns the usage to store, or the refusal.
 * Never mutates.
 */
export function reserve<M extends Meter>(
  allowance: Allowance<M>,
  usage: Usage | undefined,
  request: UseRequest<M>,
  until = new Date(Date.parse(request.at) + HOLD_SECONDS * 1000).toISOString(),
): { ok: true; usage: Usage } | Refusal {
  const allowed = check(allowance, usage, request)
  if (!allowed.ok) return allowed
  const next = record(usage, request, request.worstCaseMinor)
  return { ok: true, usage: { ...next, holds: [...(next.holds ?? []), { request, until }] } }
}

const same = (a: UseRequest, b: UseRequest) =>
  a.meter === b.meter &&
  a.amount === b.amount &&
  a.personId === b.personId &&
  a.at === b.at &&
  a.worstCaseMinor === b.worstCaseMinor

/**
 * Settles a held request once the AI has answered or failed: what it really cost replaces its
 * worst case, and a request that does not count gives its amount back. A request held for more
 * than it used, such as a talk held for its longest time, gives `amount` as what it used. Its
 * place in the hourly count stays. A request already given back by `reclaim` counts again only if
 * it counts. A request held in a month that has since ended changes nothing. Never mutates.
 */
export function settle(
  usage: Usage | undefined,
  request: UseRequest,
  outcome: { counted: boolean; costMinor: number; amount?: number },
): Usage {
  const month = request.at.slice(0, 7)
  if (usage && usage.period > month) return usage
  const now = current(usage, request.at)
  const day = request.at.slice(0, 10)
  const index = (now.holds ?? []).findIndex((hold) => same(hold.request, request))
  // Not held any more: `reclaim` gave its amount back but kept its worst case in the day's spend.
  const held = index >= 0 ? request.amount : 0
  return {
    ...now,
    ...(now.holds ? { holds: now.holds.filter((_, i) => i !== index) } : {}),
    used: {
      ...now.used,
      [request.meter]: Math.max(
        0,
        (now.used[request.meter] ?? 0) -
          held +
          (outcome.counted ? Math.max(0, outcome.amount ?? request.amount) : 0),
      ),
    },
    spendByDay: {
      ...now.spendByDay,
      [day]: Math.max(
        0,
        (now.spendByDay[day] ?? 0) - request.worstCaseMinor + Math.max(0, outcome.costMinor),
      ),
    },
  }
}

/**
 * Gives back every hold whose time has passed: a request the app started and never settled, as
 * when it stopped mid-request. Its amount returns to the month; its worst-case spend stays counted,
 * since what it cost is unknown. Never mutates.
 */
export function reclaim(usage: Usage | undefined, at: string): Usage | undefined {
  let next = usage
  for (const hold of usage?.holds ?? [])
    if (hold.until < at)
      next = settle(next, hold.request, {
        counted: false,
        costMinor: hold.request.worstCaseMinor,
      })
  return next
}

/**
 * How long the next phone call may run: the longest call or what is left of `meter`, the kind the
 * app counts calls in, whichever is less.
 */
export function callWindowSeconds<M extends Meter>(
  allowance: Allowance<M>,
  usage: Usage | undefined,
  at: string,
  longest: number,
  meter: M,
) {
  return Math.min(longest, remaining(allowance, usage, meter, at))
}

/**
 * How long the next talking session may run: the session cap or what is left of `meter`, the
 * kind the app counts talking in, whichever is less.
 */
export function talkWindowSeconds<M extends Meter>(
  allowance: Allowance<M>,
  usage: Usage | undefined,
  at: string,
  meter: M,
) {
  return Math.min(allowance.maxTalkSessionSeconds, remaining(allowance, usage, meter, at))
}
