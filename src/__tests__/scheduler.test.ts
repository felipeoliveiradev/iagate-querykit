import { describe, it, expect, vi, afterEach } from 'vitest'
import { scheduler } from '../scheduler'

describe('scheduler', () => {
  afterEach(() => {
    scheduler.clear()
  })

  it('schedules and unschedules tasks', async () => {
    const fn = vi.fn()
    scheduler.schedule('job1', fn, 1)
    await new Promise(r => setTimeout(r, 5))
    scheduler.unschedule('job1')
    const calls = fn.mock.calls.length
    expect(calls).toBeGreaterThan(0)
    expect(scheduler.list()).toEqual([])
  })

  it('lists active jobs and clear() unschedules all (B2)', () => {
    scheduler.schedule('a', () => {}, 60_000)
    scheduler.schedule('b', () => {}, 60_000)
    expect(scheduler.list().sort()).toEqual(['a', 'b'])
    scheduler.clear()
    expect(scheduler.list()).toEqual([])
  })
}) 