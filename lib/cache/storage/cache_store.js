'use strict';

/**
 * Cache store interface.
 */
class CacheStore {
  /**
   * Fetches a cache entry.
   * 
   * @param {string} key The cache key
   * @return {any} The cached value or null
   */
  read(key) {
    throw new Error('Override me!');
  }

  /**
   * Adds/updates a cache entry.
   *
   * @param {string} key The cache key
   * @param {any} value The cached value 
   */
  write(key, value) {
    throw new Error('Override me!');
  }

  /**
   * Removes a cache entry.
   *
   * @param {string} key The key to remove
   */
  remove(key) {
    throw new Error('Override me!');
  }

  /**
   * Clears the cache of all entries.
   */
  flush() {
    throw new Error('Override me!');
  }
}

module.exports = { CacheStore };
