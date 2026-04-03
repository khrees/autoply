import type { QueueItem } from '../types';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { getAutoplyDir, ensureAutoplyDir } from '../db';

const QUEUE_FILE = 'queue.json';

export class ApplicationQueue {
  private items: Map<string, QueueItem> = new Map();
  private processing = false;
  private persistPath: string;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(persistPath = join(getAutoplyDir(), QUEUE_FILE)) {
    this.persistPath = persistPath;
  }

  add(url: string): QueueItem {
    const item: QueueItem = {
      id: randomUUID(),
      url,
      status: 'pending',
    };
    this.items.set(item.id, item);
    return item;
  }

  addMany(urls: string[]): QueueItem[] {
    return urls.map((url) => this.add(url));
  }

  get(id: string): QueueItem | undefined {
    return this.items.get(id);
  }

  getAll(): QueueItem[] {
    return Array.from(this.items.values());
  }

  getPending(): QueueItem[] {
    return this.getAll().filter((item) => item.status === 'pending');
  }

  getProcessing(): QueueItem | undefined {
    return this.getAll().find((item) => item.status === 'processing');
  }

  getCompleted(): QueueItem[] {
    return this.getAll().filter((item) => item.status === 'completed');
  }

  getFailed(): QueueItem[] {
    return this.getAll().filter((item) => item.status === 'failed');
  }

  updateStatus(id: string, status: QueueItem['status'], error?: string): void {
    const item = this.items.get(id);
    if (item) {
      item.status = status;
      if (error) item.error = error;
      this.debouncedPersist();
    }
  }

  setResult(id: string, result: QueueItem['result']): void {
    const item = this.items.get(id);
    if (item) {
      item.result = result;
      this.debouncedPersist();
    }
  }

  remove(id: string): boolean {
    const result = this.items.delete(id);
    if (result) this.debouncedPersist();
    return result;
  }

  clear(): void {
    this.items.clear();
    this.processing = false;
    this.deletePersisted();
  }

  size(): number {
    return this.items.size;
  }

  isEmpty(): boolean {
    return this.items.size === 0;
  }

  hasNext(): boolean {
    return this.getPending().length > 0;
  }

  getNext(): QueueItem | undefined {
    return this.getPending()[0];
  }

  isProcessing(): boolean {
    return this.processing;
  }

  setProcessing(value: boolean): void {
    this.processing = value;
  }

  getStats(): {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  } {
    const counts = { pending: 0, processing: 0, completed: 0, failed: 0 };
    for (const item of this.items.values()) {
      if (item.status in counts) counts[item.status as keyof typeof counts]++;
    }
    return { total: this.items.size, ...counts };
  }

  private debouncedPersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persist();
    }, 500);
  }

  /** Flush any pending debounced persist immediately. Useful in tests. */
  flushPersist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.persist();
  }

  persist(): void {
    try {
      ensureAutoplyDir();
      const data = {
        items: Array.from(this.items.entries()),
        processing: this.processing,
        savedAt: new Date().toISOString(),
      };
      writeFileSync(this.persistPath, JSON.stringify(data, null, 2));
    } catch {
      // Persistence is best-effort
    }
  }

  load(): boolean {
    try {
      if (!existsSync(this.persistPath)) return false;

      const content = readFileSync(this.persistPath, 'utf-8');
      const data = JSON.parse(content);

      if (!data.items || !Array.isArray(data.items)) return false;

      this.items = new Map(data.items);
      this.processing = false;

      // Reset any "processing" items to "pending" (interrupted)
      for (const item of this.items.values()) {
        if (item.status === 'processing') {
          item.status = 'pending';
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  deletePersisted(): void {
    try {
      if (existsSync(this.persistPath)) {
        unlinkSync(this.persistPath);
      }
    } catch {
      // Best-effort
    }
  }

  hasPersisted(): boolean {
    return existsSync(this.persistPath);
  }

  getPersistedInfo(): { pending: number; savedAt: string } | null {
    try {
      if (!existsSync(this.persistPath)) return null;

      const content = readFileSync(this.persistPath, 'utf-8');
      const data = JSON.parse(content);

      if (!data.items || !Array.isArray(data.items)) return null;

      const pending = data.items.filter(
        ([_, item]: [string, QueueItem]) => item.status === 'pending' || item.status === 'processing'
      ).length;
      return { pending, savedAt: data.savedAt };
    } catch {
      return null;
    }
  }
}

export const applicationQueue = new ApplicationQueue();
