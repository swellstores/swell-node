'use strict';

const { assert } = require('chai');

const { SharedMemoryStore } = require('./shared_memory_store');

describe('SharedMemoryStore', () => {
  describe('#read/write', () => {
    it('reads and writes entries', () => {
      const store = new SharedMemoryStore();

      let cachedResult = store.read('foo');
      assert.isUndefined(cachedResult);

      // Add the cache entry
      store.write('foo', 'bar')

      cachedResult = store.read('foo');
      assert.strictEqual(cachedResult, 'bar');

      // Update the cache entry
      store.write('foo', 'baz');

      cachedResult = store.read('foo');
      assert.strictEqual(cachedResult, 'baz');
    });

    it('shares a single memory instance', () => {
      const store1 = new SharedMemoryStore();
      const store2 = new SharedMemoryStore();

      store1.write('foo', 'bar');

      assert.strictEqual(store1.read('foo'), 'bar');
      assert.strictEqual(store2.read('foo'), 'bar');
    });
  }); // describe: #read/write

  describe('#remove', () => {
    it('removes a single cache entry', () => {
      const store = new SharedMemoryStore();

      store.write('a', 1);
      store.write('b', 2);
      store.write('c', 3);

      assert.strictEqual(store.read('a'), 1);
      assert.strictEqual(store.read('b'), 2);
      assert.strictEqual(store.read('c'), 3);

      // Flush the cache
      store.remove('b');

      assert.strictEqual(store.read('a'), 1);
      assert.isUndefined(store.read('b'));
      assert.strictEqual(store.read('c'), 3);
    });
  }) // describe: #remove

  describe('#flush', () => {
    it('flushes the cache', () => {
      const store = new SharedMemoryStore();

      store.write('a', 1);
      store.write('b', 2);
      store.write('c', 3);

      assert.strictEqual(store.read('a'), 1);
      assert.strictEqual(store.read('b'), 2);
      assert.strictEqual(store.read('c'), 3);

      // Flush the cache
      store.flush();

      assert.isUndefined(store.read('a'));
      assert.isUndefined(store.read('b'));
      assert.isUndefined(store.read('c'));
    });
  }) // describe: #flush
});
