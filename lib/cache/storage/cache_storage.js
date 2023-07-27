'use strict';

/**
 * Cache store interface.
 */
class CacheStorage {
  read(key) {
    throw new Error('Override me!');
  }

  write(key, value) {
    throw new Error('Override me!');
  }

  remove(key) {
    throw new Error('Override me!');
  }

  flush() {
    throw new Error('Override me!');
  }
}

module.exports = { CacheStorage };
