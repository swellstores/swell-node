'use strict';

const { MemoryStorage } = require('./memory_storage');
const { SharedMemoryStorage } = require('./shared_memory_storage');

class CacheStoreFactory {
  /**
   * Returns an instance of a cache store
   * 
   * @param {string} storageType
   * @return {CacheStorage} the cache storage instance
   */  
  static getCacheStore(storageType) {
    // Initialize cache storage
    switch (storageType) {
      case 'memory': {
        return new MemoryStorage();
      }
      case 'shared-memory': {
        return new SharedMemoryStorage();
      }
      default: {
        throw new Error(`${storageType} storage is not currently supported`);
      }
    }
  }
}

module.exports = { CacheStoreFactory };
