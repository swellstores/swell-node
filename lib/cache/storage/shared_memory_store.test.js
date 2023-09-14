'use strict';

const { SharedMemoryStore } = require('./shared_memory_store');

describe('SharedMemoryStore', () => {
  describe('#read/write', () => {
    it('reads and writes entries', () => {
      const store = new SharedMemoryStore();

      let cachedResult = store.read('foo');
      expect(cachedResult).toBe(undefined);

      // Add the cache entry
      store.write('foo', 'bar')

      cachedResult = store.read('foo');
      expect(cachedResult).toEqual('bar');

      // Update the cache entry
      store.write('foo', 'baz');

      cachedResult = store.read('foo');
      expect(cachedResult).toEqual('baz');
    });

    it('shares a single memory instance', () => {
      const store1 = new SharedMemoryStore();
      const store2 = new SharedMemoryStore();

      store1.write('foo', 'bar');

      expect(store1.read('foo')).toEqual('bar');
      expect(store2.read('foo')).toEqual('bar');
    });
  }); // describe: #read/write

  describe('#remove', () => {
    it('removes a single cache entry', () => {
      const store = new SharedMemoryStore();

      store.write('a', 1);
      store.write('b', 2);
      store.write('c', 3);

      expect(store.read('a')).toEqual(1);
      expect(store.read('b')).toEqual(2);
      expect(store.read('c')).toEqual(3);

      // Flush the cache
      store.remove('b');

      expect(store.read('a')).toEqual(1);
      expect(store.read('b')).toBe(undefined);
      expect(store.read('c')).toEqual(3);
    });
  }) // describe: #remove

  describe('#flush', () => {
    it('flushes the cache', () => {
      const store = new SharedMemoryStore();

      store.write('a', 1);
      store.write('b', 2);
      store.write('c', 3);

      expect(store.read('a')).toEqual(1);
      expect(store.read('b')).toEqual(2);
      expect(store.read('c')).toEqual(3);

      // Flush the cache
      store.flush();

      expect(store.read('a')).toBe(undefined);
      expect(store.read('b')).toBe(undefined);
      expect(store.read('c')).toBe(undefined);
    });
  }) // describe: #flush
});
