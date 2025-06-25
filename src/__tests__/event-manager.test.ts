import { describe, it, expect } from 'vitest';
import { eventManager } from '../event-manager';
import { setEventBus } from '../config';

describe('EventManager', () => {
  it('handles local listeners', () => {
    let called = 0;
    const off = eventManager.on('x', () => { called++; });
    eventManager.emit('x');
    expect(called).toBe(1);
    off();
    eventManager.emit('x');
    expect(called).toBe(1);
  });

  it('delegates to external bus if provided', () => {
    let external = 0;
    setEventBus({ emit() { external++; } } as any);
    eventManager.emit('y');
    expect(external).toBe(1);
    setEventBus(undefined as any);
  });
}); 