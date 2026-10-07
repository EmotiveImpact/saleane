/** Morning, afternoon and evening, so a long run of times reads at a glance. */
export function groupTimes<T extends { value: number }>(times: T[]) {
  return [
    { label: 'Morning', times: times.filter((t) => t.value < 720) },
    { label: 'Afternoon', times: times.filter((t) => t.value >= 720 && t.value < 1020) },
    { label: 'Evening', times: times.filter((t) => t.value >= 1020) },
  ].filter((group) => group.times.length)
}
