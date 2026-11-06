// Tells the browser something changed. Screens listen on /events and refetch.

type Listener = (topic: string) => void

export interface Events {
  emit(topic: string): void
  subscribe(listener: Listener): () => void
}

export function createEvents(): Events {
  const listeners = new Set<Listener>()
  return {
    emit(topic) {
      for (const listener of listeners) listener(topic)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
