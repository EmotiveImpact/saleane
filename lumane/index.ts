/**
 * Lumane: the assistant engine shared by SALEANE and future apps. It holds the parts that know
 * nothing about any one business: skills, the tap-to-approve step, allowances and limits, its own
 * safety rules, the audit trail and the swappable AI brain and voice. Each app hands it a pack
 * (`pack.ts`) with its name, its pathways, its rules and the kinds of use it sells.
 *
 * This folder must not import anything from the app that uses it, so it can move to its own
 * repository unchanged.
 */
export * from './allowance'
export * from './brain'
export * from './claude'
export * from './engine'
export * from './live'
export * from './pack'
export * from './rules'
export * from './skill'
export * from './talk'
export * from './voice'
