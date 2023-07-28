'use strict';

const { MemoryStorage } = require('./memory_storage');

/**
 * Cache storage implementation: global memoization.
 */
class SharedMemoryStorage extends MemoryStorage {
  static sharedMemory = {};

  constructor() {
    super(SharedMemoryStorage.sharedMemory);
  }
}

module.exports = { SharedMemoryStorage };
