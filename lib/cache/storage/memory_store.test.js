'use strict';

const { MemoryStore } = require('./memory_store');

describe('MemoryStore', () => {
  describe('#read/write', () => {
    it('reads and writes entries', () => {
      const store = new MemoryStore();

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

    it('maintains its own memory space', () => {
      const store1 = new MemoryStore();
      const store2 = new MemoryStore();

      store1.write('foo', 'bar');

      expect(store1.read('foo')).toEqual('bar');
      expect(store2.read('foo')).toBe(undefined);
    });
  }); // describe: #read/write

  describe('#remove', () => {
    it('removes a single cache entry', () => {
      const store = new MemoryStore();

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
      const store = new MemoryStore();

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
