'use strict';

const { CacheStorage } = require('./cache_storage');

/**
 * Cache storage implementation: local memoization.
 */
class MemoryStorage extends CacheStorage {
  constructor(memory) {
    super();
    this.memory = memory || {};
  }

  read(key) {
    return this.memory[key];
  }

  write(key, value) {
    this.memory[key] = value;
  }

  remove(key) {
    delete this.memory[key];
  }

  flush() {
    this.memory = {};
  }
}

module.exports = { MemoryStorage };
