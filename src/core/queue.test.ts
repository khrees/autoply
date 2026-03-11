import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { ApplicationQueue } from './queue';

describe('ApplicationQueue', () => {
  let queue: ApplicationQueue;

  beforeEach(() => {
    queue = new ApplicationQueue();
    queue.clear();
  });

  describe('add', () => {
    test('adds item with pending status', () => {
      const item = queue.add('https://example.com/job1');

      expect(item.url).toBe('https://example.com/job1');
      expect(item.status).toBe('pending');
      expect(item.id).toBeTruthy();
    });

    test('generates unique IDs', () => {
      const item1 = queue.add('https://example.com/job1');
      const item2 = queue.add('https://example.com/job2');

      expect(item1.id).not.toBe(item2.id);
    });
  });

  describe('addMany', () => {
    test('adds multiple items', () => {
      const urls = [
        'https://example.com/job1',
        'https://example.com/job2',
        'https://example.com/job3',
      ];

      const items = queue.addMany(urls);

      expect(items.length).toBe(3);
      expect(queue.size()).toBe(3);
    });
  });

  describe('get', () => {
    test('retrieves item by id', () => {
      const added = queue.add('https://example.com/job1');
      const retrieved = queue.get(added.id);

      expect(retrieved).toEqual(added);
    });

    test('returns undefined for non-existent id', () => {
      const retrieved = queue.get('non-existent');

      expect(retrieved).toBeUndefined();
    });
  });

  describe('getAll', () => {
    test('returns all items', () => {
      queue.add('https://example.com/job1');
      queue.add('https://example.com/job2');

      const all = queue.getAll();

      expect(all.length).toBe(2);
    });

    test('returns empty array when queue is empty', () => {
      const all = queue.getAll();

      expect(all).toEqual([]);
    });
  });

  describe('filtering methods', () => {
    beforeEach(() => {
      const item1 = queue.add('https://example.com/job1');
      const item2 = queue.add('https://example.com/job2');
      const _item3 = queue.add('https://example.com/job3');

      queue.updateStatus(item1.id, 'completed');
      queue.updateStatus(item2.id, 'failed', 'Network error');
      // item3 stays pending
    });

    test('getPending returns only pending items', () => {
      const pending = queue.getPending();

      expect(pending.length).toBe(1);
      expect(pending[0].status).toBe('pending');
    });

    test('getCompleted returns only completed items', () => {
      const completed = queue.getCompleted();

      expect(completed.length).toBe(1);
      expect(completed[0].status).toBe('completed');
    });

    test('getFailed returns only failed items', () => {
      const failed = queue.getFailed();

      expect(failed.length).toBe(1);
      expect(failed[0].status).toBe('failed');
      expect(failed[0].error).toBe('Network error');
    });
  });

  describe('updateStatus', () => {
    test('updates item status', () => {
      const item = queue.add('https://example.com/job1');
      queue.updateStatus(item.id, 'processing');

      const updated = queue.get(item.id);
      expect(updated?.status).toBe('processing');
    });

    test('sets error when provided', () => {
      const item = queue.add('https://example.com/job1');
      queue.updateStatus(item.id, 'failed', 'Something went wrong');

      const updated = queue.get(item.id);
      expect(updated?.error).toBe('Something went wrong');
    });
  });

  describe('remove', () => {
    test('removes item from queue', () => {
      const item = queue.add('https://example.com/job1');
      const removed = queue.remove(item.id);

      expect(removed).toBe(true);
      expect(queue.get(item.id)).toBeUndefined();
    });

    test('returns false for non-existent item', () => {
      const removed = queue.remove('non-existent');

      expect(removed).toBe(false);
    });
  });

  describe('clear', () => {
    test('removes all items', () => {
      queue.add('https://example.com/job1');
      queue.add('https://example.com/job2');
      queue.clear();

      expect(queue.isEmpty()).toBe(true);
    });
  });

  describe('size and isEmpty', () => {
    test('size returns correct count', () => {
      expect(queue.size()).toBe(0);

      queue.add('https://example.com/job1');
      expect(queue.size()).toBe(1);

      queue.add('https://example.com/job2');
      expect(queue.size()).toBe(2);
    });

    test('isEmpty returns true when empty', () => {
      expect(queue.isEmpty()).toBe(true);
    });

    test('isEmpty returns false when not empty', () => {
      queue.add('https://example.com/job1');
      expect(queue.isEmpty()).toBe(false);
    });
  });

  describe('hasNext and getNext', () => {
    test('hasNext returns true when pending items exist', () => {
      queue.add('https://example.com/job1');
      expect(queue.hasNext()).toBe(true);
    });

    test('hasNext returns false when no pending items', () => {
      const item = queue.add('https://example.com/job1');
      queue.updateStatus(item.id, 'completed');

      expect(queue.hasNext()).toBe(false);
    });

    test('getNext returns first pending item', () => {
      queue.add('https://example.com/job1');
      queue.add('https://example.com/job2');

      const next = queue.getNext();
      expect(next?.url).toBe('https://example.com/job1');
    });
  });

  describe('getStats', () => {
    test('returns correct statistics', () => {
      const item1 = queue.add('https://example.com/job1');
      const item2 = queue.add('https://example.com/job2');
      queue.add('https://example.com/job3');
      queue.add('https://example.com/job4');

      queue.updateStatus(item1.id, 'completed');
      queue.updateStatus(item2.id, 'failed');

      const stats = queue.getStats();

      expect(stats.total).toBe(4);
      expect(stats.pending).toBe(2);
      expect(stats.completed).toBe(1);
      expect(stats.failed).toBe(1);
      expect(stats.processing).toBe(0);
    });
  });

  describe('processing state', () => {
    test('isProcessing returns current state', () => {
      expect(queue.isProcessing()).toBe(false);

      queue.setProcessing(true);
      expect(queue.isProcessing()).toBe(true);

      queue.setProcessing(false);
      expect(queue.isProcessing()).toBe(false);
    });

    test('getProcessing returns item with processing status', () => {
      const item = queue.add('https://example.com/job1');
      queue.updateStatus(item.id, 'processing');

      const processing = queue.getProcessing();
      expect(processing?.id).toBe(item.id);
    });
  });

  describe('persistence', () => {
    afterEach(() => {
      queue.clear(); // also deletes persisted file
    });

    test('persist and load roundtrips items', () => {
      queue.add('https://example.com/job1');
      queue.add('https://example.com/job2');
      queue.persist();

      const newQueue = new ApplicationQueue();
      const loaded = newQueue.load();

      expect(loaded).toBe(true);
      expect(newQueue.size()).toBe(2);
      expect(newQueue.getPending().length).toBe(2);

      newQueue.clear();
    });

    test('load resets processing items to pending', () => {
      const item = queue.add('https://example.com/job1');
      queue.updateStatus(item.id, 'processing');
      queue.persist();

      const newQueue = new ApplicationQueue();
      newQueue.load();

      const recovered = newQueue.get(item.id);
      expect(recovered?.status).toBe('pending');

      newQueue.clear();
    });

    test('load preserves completed and failed statuses', () => {
      const item1 = queue.add('https://example.com/job1');
      const item2 = queue.add('https://example.com/job2');
      queue.updateStatus(item1.id, 'completed');
      queue.updateStatus(item2.id, 'failed', 'Network error');
      queue.persist();

      const newQueue = new ApplicationQueue();
      newQueue.load();

      expect(newQueue.get(item1.id)?.status).toBe('completed');
      expect(newQueue.get(item2.id)?.status).toBe('failed');
      expect(newQueue.get(item2.id)?.error).toBe('Network error');

      newQueue.clear();
    });

    test('load returns false when no persisted file', () => {
      const freshQueue = new ApplicationQueue();
      // ensure no file exists
      freshQueue.deletePersisted();

      expect(freshQueue.load()).toBe(false);
    });

    test('hasPersisted returns true after persist', () => {
      queue.add('https://example.com/job1');
      queue.persist();

      expect(queue.hasPersisted()).toBe(true);
    });

    test('hasPersisted returns false after clear', () => {
      queue.add('https://example.com/job1');
      queue.persist();
      queue.clear();

      expect(queue.hasPersisted()).toBe(false);
    });

    test('getPersistedInfo returns pending count and timestamp', () => {
      queue.add('https://example.com/job1');
      queue.add('https://example.com/job2');
      const item3 = queue.add('https://example.com/job3');
      queue.updateStatus(item3.id, 'completed');
      queue.persist();

      const info = queue.getPersistedInfo();

      expect(info).not.toBeNull();
      expect(info!.pending).toBe(2);
      expect(info!.savedAt).toBeTruthy();
    });

    test('getPersistedInfo returns null when no file', () => {
      queue.deletePersisted();
      expect(queue.getPersistedInfo()).toBeNull();
    });

    test('updateStatus auto-persists', () => {
      const item = queue.add('https://example.com/job1');
      queue.persist(); // initial persist
      queue.updateStatus(item.id, 'completed');

      const newQueue = new ApplicationQueue();
      newQueue.load();
      expect(newQueue.get(item.id)?.status).toBe('completed');

      newQueue.clear();
    });
  });
});
