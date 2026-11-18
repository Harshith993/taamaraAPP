/**
 * An in-process event bus for live updates (chat). The app runs as one server (D5), so a plain
 * EventEmitter is enough; it lives on globalThis so hot reloads in development share it.
 * Moving to several servers would mean Postgres LISTEN/NOTIFY here, with the same interface.
 */
import { EventEmitter } from "node:events";

const g = globalThis as unknown as { taamaraBus?: EventEmitter };
const bus = g.taamaraBus ?? new EventEmitter();
bus.setMaxListeners(0);
g.taamaraBus = bus;

export function publish(topic: string, payload: unknown = {}) {
  bus.emit(topic, payload);
}

export function subscribe(topic: string, fn: (payload: unknown) => void): () => void {
  bus.on(topic, fn);
  return () => bus.off(topic, fn);
}
