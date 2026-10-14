type Task = () => void | Promise<void>;

const timers = new Map<string, ReturnType<typeof setInterval>>();

export const scheduler = {
  schedule(name: string, task: Task, intervalMs: number) {
    scheduler.unschedule(name);
    const t = setInterval(() => {
      void Promise.resolve(task()).catch((err) => {
        console.error(`Scheduler task '${name}' failed:`, err);
      });
    }, intervalMs);
    if (typeof (t as any).unref === 'function') (t as any).unref();
    timers.set(name, t);
  },

  unschedule(name: string) {
    const t = timers.get(name);
    if (t) {
      clearInterval(t);
      timers.delete(name);
    }
  },

  list(): string[] {
    return Array.from(timers.keys());
  },

  clear() {
    for (const name of Array.from(timers.keys())) scheduler.unschedule(name);
  },
};
