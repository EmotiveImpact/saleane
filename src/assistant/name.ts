import { askName } from '../../lumane'

/**
 * SALEANE's name as LUMANE shows it, and the one place the assistant's name is written. The pack,
 * the AI's instructions and every screen that names the assistant take it from here, so another
 * app using LUMANE changes only this line to be "Ask" and its own name.
 */
export const APP_NAME = 'SALEANE'
/** "Ask SALEANE": what the studio team calls the assistant. */
export const ASK_NAME = askName({ name: APP_NAME })
