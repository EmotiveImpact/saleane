// A small stand-in for Node's Buffer, covering only what the server code uses.
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export class Buffer extends Uint8Array {
  static from(value: string | ArrayLike<number> | Uint8Array, encoding = 'utf8'): Buffer {
    if (typeof value !== 'string') {
      const out = new Buffer(value.length)
      out.set(value)
      return out
    }
    if (encoding === 'hex') {
      const out = new Buffer(value.length / 2)
      for (let i = 0; i < out.length; i++) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16)
      return out
    }
    if (encoding === 'base64' || encoding === 'base64url') {
      const text = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
      const out = new Buffer(text.length)
      for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i)
      return out
    }
    return new Buffer(encoder.encode(value))
  }
  static isBuffer(value: unknown): value is Buffer {
    return value instanceof Buffer
  }
  static concat(list: Uint8Array[]): Buffer {
    const out = new Buffer(list.reduce((n, item) => n + item.length, 0))
    let at = 0
    for (const item of list) {
      out.set(item, at)
      at += item.length
    }
    return out
  }
  toString(encoding = 'utf8'): string {
    if (encoding === 'hex') return Array.from(this, (b) => b.toString(16).padStart(2, '0')).join('')
    if (encoding === 'base64' || encoding === 'base64url') {
      let binary = ''
      for (let i = 0; i < this.length; i += 0x8000)
        binary += String.fromCharCode(...this.subarray(i, i + 0x8000))
      const text = btoa(binary)
      return encoding === 'base64'
        ? text
        : text.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    }
    return decoder.decode(this)
  }
}
