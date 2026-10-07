export const resolve = (...parts: string[]) => parts.join('/')
export const dirname = (path: string) => path.split('/').slice(0, -1).join('/') || '/'
