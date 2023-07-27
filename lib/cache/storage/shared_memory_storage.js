'use strict';

const { MemoryStorage } = require('./memory_storage');

/**
 * Cache storage implementation: global memoization.
 */
class SharedMemoryStorage extends MemoryStorage {
  static sharedMemory = {};

  constructor() {
    super();
    this.memory = SharedMemoryStorage.sharedMemory;
  }
}

module.exports = { SharedMemoryStorage };
