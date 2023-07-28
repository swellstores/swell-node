'use strict';

const { MemoryStore } = require('./memory_store');
const { SharedMemoryStore } = require('./shared_memory_store');

class CacheStoreFactory {
  /**
   * Returns an instance of a cache store
   * 
   * @param {string} storageType
   * @return {CacheStore} the cache storage instance
   */  
  static getCacheStore(storageType) {
    // Initialize cache storage
    switch (storageType) {
      case 'memory': {
        return new MemoryStore();
      }
      case 'shared-memory': {
        return new SharedMemoryStore();
      }
      default: {
        throw new Error(`${storageType} storage is not currently supported`);
      }
    }
  }
}

module.exports = { CacheStoreFactory };
