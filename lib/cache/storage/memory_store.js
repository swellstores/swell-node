'use strict';

const { CacheStore } = require('./cache_store');

/**
 * Cache store: local memoization.
 */
class MemoryStore extends CacheStore {
  constructor() {
    super();
    this.memory = {};
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

module.exports = { MemoryStore };
