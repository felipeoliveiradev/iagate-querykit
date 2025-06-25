type Listener = (...args: any[]) => void;
import { QueryKitConfig } from './config';

export class EventManager {
  private listeners: Record<string, Listener[]> = {};

  public on(eventName: string, listener: Listener): () => void {
    if (!this.listeners[eventName]) {
      this.listeners[eventName] = [];
    }
    this.listeners[eventName].push(listener);
    return () => this.off(eventName, listener);
  }

  public off(eventName: string, listener: Listener): void {
    if (!this.listeners[eventName]) return;
    this.listeners[eventName] = this.listeners[eventName].filter(l => l !== listener);
  }

  public emit(eventName: string, ...args: any[]): void {
    if (this.listeners[eventName]) {
      this.listeners[eventName].forEach(listener => {
        try { listener(...args); } catch (error) { console.error(`Error in event listener for '${eventName}':`, error); }
      });
    }
    if (QueryKitConfig.eventBus) {
      try { QueryKitConfig.eventBus.emit(eventName, ...args); } catch {}
    }
  }
}

export const eventManager = new EventManager(); 