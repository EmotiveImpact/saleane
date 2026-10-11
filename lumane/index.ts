/**
 * Lumane: the assistant engine shared by SALEANE and future apps. It holds the parts that know
 * nothing about any one business: skills, the tap-to-approve step, allowances and limits, the
 * audit trail and the swappable AI brain. Each app supplies its own skills, rules and voice.
 *
 * This folder must not import anything from the app that uses it, so it can move to its own
 * repository unchanged.
 */
export * from './allowance'
export * from './brain'
export * from './claude'
export * from './engine'
export * from './live'
export * from './skill'
export * from './talk'
export * from './voice'
