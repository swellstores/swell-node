'use strict';

const { assert } = require('chai');

const { MemoryStore } = require('./memory_store');

describe('MemoryStore', () => {
  describe('#read/write', () => {
    it('reads and writes entries', () => {
      const store = new MemoryStore();

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

    it('maintains its own memory space', () => {
      const store1 = new MemoryStore();
      const store2 = new MemoryStore();

      store1.write('foo', 'bar');

      assert.strictEqual(store1.read('foo'), 'bar');
      assert.isUndefined(store2.read('foo'));
    });
  }); // describe: #read/write

  describe('#remove', () => {
    it('removes a single cache entry', () => {
      const store = new MemoryStore();

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
      const store = new MemoryStore();

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
