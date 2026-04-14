export interface TaskEntry {
  id: string;
  title: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  error?: string;
  addedAt: number;
  startedAt?: number;
  finishedAt?: number;
}

export interface TaskSnapshot {
  total: number;
  completed: number;
  failed: number;
  active: number;
  tasks: TaskEntry[];
}

export class TaskTracker {
  private tasks = new Map<string, TaskEntry>();
  private resetTimer: ReturnType<typeof setTimeout> | null = null;

  add(id: string, title: string) {
    this.cancelReset();
    // Don't re-add if already tracked in current cycle
    if (this.tasks.has(id)) return;
    this.tasks.set(id, {
      id,
      title,
      status: 'queued',
      addedAt: Date.now(),
    });
  }

  start(id: string) {
    const task = this.tasks.get(id);
    if (task) {
      task.status = 'processing';
      task.startedAt = Date.now();
    }
  }

  complete(id: string) {
    const task = this.tasks.get(id);
    if (task) {
      task.status = 'completed';
      task.finishedAt = Date.now();
    }
    this.scheduleResetIfIdle();
  }

  fail(id: string, error: string) {
    const task = this.tasks.get(id);
    if (task) {
      task.status = 'failed';
      task.error = error;
      task.finishedAt = Date.now();
    }
    this.scheduleResetIfIdle();
  }

  getSnapshot(): TaskSnapshot {
    const tasks = [...this.tasks.values()];
    const completed = tasks.filter((t) => t.status === 'completed').length;
    const failed = tasks.filter((t) => t.status === 'failed').length;
    return {
      total: tasks.length,
      completed,
      failed,
      active: tasks.length - completed - failed,
      tasks: tasks.sort((a, b) => b.addedAt - a.addedAt),
    };
  }

  /** Mark all queued tasks as cancelled (failed) and return their IDs */
  cancelQueued(): string[] {
    const cancelled: string[] = [];
    for (const task of this.tasks.values()) {
      if (task.status === 'queued') {
        task.status = 'failed';
        task.error = '已取消';
        task.finishedAt = Date.now();
        cancelled.push(task.id);
      }
    }
    this.scheduleResetIfIdle();
    return cancelled;
  }

  hasActiveTasks(): boolean {
    return [...this.tasks.values()].some(
      (t) => t.status === 'queued' || t.status === 'processing',
    );
  }

  isTaskActive(id: string): boolean {
    const task = this.tasks.get(id);
    return task?.status === 'queued' || task?.status === 'processing';
  }

  private scheduleResetIfIdle() {
    if (this.hasActiveTasks()) return;
    this.cancelReset();
    this.resetTimer = setTimeout(() => {
      this.tasks.clear();
      this.resetTimer = null;
    }, 5000);
  }

  private cancelReset() {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
  }
}

export const taskTracker = new TaskTracker();
