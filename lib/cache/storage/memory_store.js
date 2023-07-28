'use strict';

const { CacheStore } = require('./cache_store');

/**
 * Cache store: local memoization.
 */
class MemoryStore extends CacheStore {
  constructor() {
    super();
    this.cache = new Map();
  }

  read(key) {
    return this.cache.get(key);
  }

  write(key, value) {
    this.cache.set(key, value);
  }

  remove(key) {
    this.cache.delete(key);
  }

  flush() {
    this.cache.clear();
  }
}

module.exports = { MemoryStore };
