// Browser stand-in for node:http and node:https. The demo never sends anything over the network.
function request(): never {
  throw Object.assign(new Error('The demo does not send anything.'), { code: 'ENETUNREACH' })
}
export default { request }
export { request }
