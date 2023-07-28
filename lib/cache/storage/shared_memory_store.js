'use strict';

const { CacheStore } = require('./cache_store');
const { MemoryStore } = require('./memory_store');

/**
 * Cache store: global memoization.
 */
class SharedMemoryStore extends CacheStore {
  static storeInstance;

  constructor() {
    super();

    if (SharedMemoryStore.storeInstance === undefined) {
      SharedMemoryStore.storeInstance = new MemoryStore();
    }
    this.store = SharedMemoryStore.storeInstance;
  }

  read(key) {
    return this.store.read(key);
  }

  write(key, value) {
    this.store.write(key, value);
  }

  remove(key) {
    this.store.remove(key);
  }

  flush() {
    this.store.flush();
  }
}

module.exports = { SharedMemoryStore };
