import { EventEmitter } from 'events';
import { DexEvent, EventType } from './types';

class EventBus extends EventEmitter {
  publish(event: DexEvent): void {
    this.emit('dex:event', event);
    this.emit(`dex:${event.requestId}`, event);
  }

  subscribe(requestId: string, handler: (event: DexEvent) => void): () => void {
    const channel = `dex:${requestId}`;
    this.on(channel, handler);
    return () => this.off(channel, handler);
  }

  subscribeAll(handler: (event: DexEvent) => void): () => void {
    this.on('dex:event', handler);
    return () => this.off('dex:event', handler);
  }
}

export const bus = new EventBus();
bus.setMaxListeners(200);

export function emit(
  type: EventType,
  message: string,
  requestId: string,
  stepId?: string,
  data?: unknown,
): void {
  bus.publish({ type, message, requestId, stepId, timestamp: Date.now(), data });
}
