type Task = () => void;

const timers = new Map<string, ReturnType<typeof setInterval>>();

export const scheduler = {
  schedule(name: string, task: Task, intervalMs: number) {
    scheduler.unschedule(name);
    const t = setInterval(task, intervalMs);
    timers.set(name, t);
  },
  unschedule(name: string) {
    const t = timers.get(name);
    if (t) {
      clearInterval(t);
      timers.delete(name);
    }
  },
}; 