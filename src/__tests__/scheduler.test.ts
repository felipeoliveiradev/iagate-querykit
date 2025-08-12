import { describe, it, expect, vi } from 'vitest'
import { scheduler } from '../scheduler'

describe('scheduler', () => {
  it('schedules and unschedules tasks', async () => {
    const fn = vi.fn()
    scheduler.schedule('job1', fn, 1)
    await new Promise(r => setTimeout(r, 5))
    scheduler.unschedule('job1')
    const calls = fn.mock.calls.length
    expect(calls).toBeGreaterThan(0)
  })
}) 