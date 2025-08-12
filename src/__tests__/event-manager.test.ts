import { describe, it, expect, vi } from 'vitest';
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

  it('on/off and emit with args', () => {
    const fn = vi.fn();
    const off = eventManager.on('x', fn);
    eventManager.emit('x', 1);
    expect(fn).toHaveBeenCalledWith(1);
    off();
    eventManager.emit('x', 2);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('forwards to external eventBus if set', () => {
    const bus = { emit: vi.fn() } as any;
    setEventBus(bus);
    eventManager.emit('y', 'z');
    expect(bus.emit).toHaveBeenCalledWith('y', 'z');
    setEventBus(undefined as any);
  });

  it('logs listener error via console.error and continues', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fn = () => { throw new Error('boom') }
    eventManager.on('e1', fn)
    eventManager.emit('e1')
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('swallows errors from external eventBus.emit', () => {
    setEventBus({ emit() { throw new Error('bus error') } } as any)
    eventManager.emit('e2')
    setEventBus(undefined as any)
  })

  it('off on unknown event does nothing', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const noop = () => {}
    eventManager.off('unknown:event', noop)
    expect(errSpy).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })
}); 