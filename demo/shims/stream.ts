// Just enough of node:stream for server/http.ts's inject() to run in a browser tab.
type Listener = (...args: unknown[]) => void

class Emitter {
  private listeners = new Map<string, Listener[]>()
  on(event: string, listener: Listener) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    return this
  }
  once(event: string, listener: Listener) {
    const wrapped: Listener = (...args) => {
      this.removeListener(event, wrapped)
      listener(...args)
    }
    return this.on(event, wrapped)
  }
  removeListener(event: string, listener: Listener) {
    this.listeners.set(
      event,
      (this.listeners.get(event) ?? []).filter((item) => item !== listener),
    )
    return this
  }
  emit(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
    return true
  }
}

export class Readable extends Emitter {
  private started = false
  constructor(private readonly chunks: unknown[] = []) {
    super()
  }
  static from(chunks: unknown[]) {
    return new Readable(chunks)
  }
  on(event: string, listener: Listener) {
    super.on(event, listener)
    if (event === 'data' && !this.started) {
      this.started = true
      queueMicrotask(() => {
        for (const chunk of this.chunks) this.emit('data', chunk)
        this.emit('end')
      })
    }
    return this
  }
  resume() {
    return this
  }
}

export class Writable extends Emitter {
  constructor(
    private readonly options: {
      write: (chunk: unknown, encoding: string, callback: () => void) => void
    },
  ) {
    super()
  }
  write(chunk: unknown) {
    this.options.write(chunk, 'utf8', () => {})
    return true
  }
  end(chunk?: unknown) {
    if (chunk !== undefined && chunk !== null && chunk !== '') this.write(chunk)
    queueMicrotask(() => this.emit('finish'))
    return this
  }
}
