'use strict';

const Cache = require('./index');

const createMemoryCache = (options = {}) => {
  return new Cache('test', {
    storage: 'memory',
    ...options,
  });
};

describe('Cache', () => {
  describe('#constructor', () => {
    it('builds params from defaults', () => {
      const cache = new Cache('test', {});
      expect(cache.params).toEqual({
        clientId: 'test',
        path: '',
        storage: 'shared-memory',
        indexLimit: 1000,
      });
    });

    it('builds params from options', () => {
      const cache = new Cache('test', {
        path: '/',
        storage: 'memory',
        indexLimit: 1,
      });
      expect(cache.params).toEqual({
        clientId: 'test',
        path: '/',
        storage: 'memory',
        indexLimit: 1,
      });
    });

    it('throws an error on invalid storage', () => {
      expect(() => {
        new Cache('test', { storage: 'fail' });
      }).toThrow(Error, 'fail storage is not currently supported');
    });
  }); // describe: #constructor

  describe('#get', () => {
    let cache;

    beforeEach(() => {
      cache = createMemoryCache();
    });

    it('returns null when cache index not found', () => {
      const result = cache.get('/', {});
      expect(result).toBe(null);
    });

    it('returns response object when cache index found', () => {
      cache.put(
        '/',
        {},
        {
          $data: 'foo',
          $collection: 'bar',
          $cached: { bar: 1 },
        },
      );
      const result = cache.get('/', {});
      expect(result).toEqual({
        $data: 'foo',
        $collection: 'bar',
        $cached: true,
      });
    });

    it('stores objects in memory but cannot be modified', () => {
      const object = { test: 1 };
      cache.put(
        '/',
        {},
        {
          $data: object,
          $collection: 'bar',
          $cached: { bar: 1 },
        },
      );
      object.test = 2;
      const result = cache.get('/', {});
      expect(result).toEqual({
        $data: { test: 1 },
        $collection: 'bar',
        $cached: true,
      });
    });
  }); // describe: #get

  describe('#getKey', () => {
    it('returns a predictable key for request args', () => {
      const cache = createMemoryCache();
      const key1 = cache.getKey('/test1', true);
      const key2 = cache.getKey('/test1', true);
      const key3 = cache.getKey('/test1', false);
      const key4 = cache.getKey('/other');
      const key5 = cache.getKey(' other/ ', null);

      expect(key1 && key2 && key3 && key4 && key5).toBeTruthy();
      expect(key1).toEqual(key2);
      expect(key1).not.toEqual(key3);
      expect(key1).not.toEqual(key4);
      expect(key4).toEqual(key5);
    });
  }); // describe: #getKey

  describe('#getPath', () => {
    it('returns a cache path with arg', () => {
      const cache = createMemoryCache();
      const path = cache.getPath('index');
      expect(path).toEqual('/client.test.index');
    });

    it('returns a cache path with multiple args', () => {
      const cache = createMemoryCache();
      const path = cache.getPath('result', '12345');
      expect(path).toEqual('/client.test.result.12345');
    });

    it('returns a cache path with path param prepended', () => {
      const cache = createMemoryCache({ path: '/test' });
      const path = cache.getPath('result', '12345');
      expect(path).toEqual('/test/client.test.result.12345');
    });

    it('adds env to the cache path', () => {
      const cache = createMemoryCache({ env: 'env-name' });
      const path = cache.getPath('index');
      expect(path).toEqual('/client.test_env-name.index');
    });
  }); // describe: #getPath

  describe('#getVersions', () => {
    it('sets and returns version cache', () => {
      const cache = createMemoryCache();
      expect(cache.versions).toBe(null);
      const versions = cache.getVersions();
      expect(versions).toEqual({});
    });

    it('sets and returns version cached earlier', () => {
      const cache = createMemoryCache();
      cache.putVersion('test', 1);
      const versions = cache.getVersions();
      expect(cache.versions).toBe(versions);
      expect(versions).toEqual({ test: 1 });
    });

    it('version object is cloned on each call and not mutated', () => {
      const cache = createMemoryCache();
      cache.putVersion('test', 1);
      const versions = cache.getVersions();
      expect(cache.versions).toBe(versions);
      expect(versions).toEqual({ test: 1 });

      const versions2 = cache.getVersions();
      versions.test = 2;
      expect(versions2).toEqual({ test: 1 });
    });
  }); // describe: #getVersions

  describe('#getIndex', () => {
    it('sets and returns index cache', () => {
      const cache = createMemoryCache();
      expect(cache.indexes).toBe(null);
      const indexes = cache.getIndex();
      expect(indexes).toEqual({});
    });

    it('sets and returns index cached earlier', () => {
      const cache = createMemoryCache();
      cache.putIndex('test', '12345', 100);
      const indexes = cache.getIndex();
      expect(cache.indexes).toBe(indexes);
      expect(indexes).toEqual({ test: { 12345: 100 } });
    });

    it('gets a new index on each call', () => {
      const cache = createMemoryCache();
      cache.putIndex('test', '12345', 100);
      const index1 = cache.getIndex();
      const index2 = cache.getIndex();
      expect(index1 !== index2).toBe(true);
    });
  }); // describe: #getIndex

  describe('#put', () => {
    let cache, response;

    beforeEach(() => {
      cache = createMemoryCache();
      response = {
        $data: 'foo',
        $collection: 'bar',
        $cached: { bar: 1 },
      };
    });

    it('sets index, version and result cache', () => {
      cache.put('/', {}, response);
      expect(cache.getIndex()).toEqual({
        bar: { '58cd6550e4fe03ea78ee22cf52c759b7': 50 },
      });
      expect(cache.getVersions()).toEqual({
        bar: 1,
      });
      expect(cache.get('/', {})).toEqual({
        $data: 'foo',
        $collection: 'bar',
        $cached: true,
      });
    });
  }); // describe: #put

  describe('#putIndex', () => {
    it('sets index cache with collection version and size', () => {
      const cache = createMemoryCache();
      cache.putIndex('bar', '12345', 100);
      const indexes = cache.getIndex();
      expect(indexes).toEqual({
        bar: { 12345: 100 },
      });
      cache.putIndex('bar2', '123456', 1001);
      const indexes2 = cache.getIndex();
      expect(indexes2).toEqual({
        bar: { 12345: 100 },
        bar2: { 123456: 1001 },
      });
    });

    it('resets existing item in index cache', () => {
      const cache = createMemoryCache();
      cache.putIndex('bar', '12345', 100);
      const indexes = cache.getIndex();
      expect(indexes).toEqual({
        bar: { 12345: 100 },
      });
      cache.putIndex('bar', '12345', 1001);
      const indexes2 = cache.getIndex();
      expect(indexes2).toEqual({
        bar: { 12345: 1001 },
      });
    });
  }); // describe: #putIndex

  describe('#remove', () => {
    it('removes an entry from result cache', () => {
      const cache = createMemoryCache();
      cache.put(
        '/',
        {},
        {
          $data: 'foo',
          $collection: 'bar',
          $cached: { bar: 1 },
        },
      );
      expect(cache.get('/', {})).toEqual({
        $data: 'foo',
        $collection: 'bar',
        $cached: true,
      });
      cache.remove('/', {});
      expect(cache.get('/', {})).toEqual(null);
    });
  }); // describe: #remove

  describe('#flush', () => {
    it('clears all the cache entries', () => {
      const cache = createMemoryCache();
      cache.put(
        '/test1',
        {},
        {
          $data: 'foo',
          $collection: 'bar',
          $cached: { bar: 1 },
        },
      );
      cache.put(
        '/test2',
        {},
        {
          $data: 'foo',
          $collection: 'bar',
          $cached: { bar: 1 },
        },
      );

      expect(cache.get('/test1', {})).toEqual({
        $data: 'foo',
        $collection: 'bar',
        $cached: true,
      });
      expect(cache.get('/test2', {})).toEqual({
        $data: 'foo',
        $collection: 'bar',
        $cached: true,
      });

      cache.flush();

      expect(cache.get('/test1', {})).toBe(null);
      expect(cache.get('/test1', {})).toBe(null);
    });

    it('resets the collection index registry', () => {
      const cache = createMemoryCache();
      cache.putIndex('test', '12345', 100);

      expect(cache.getIndex()).toEqual({
        test: { 12345: 100 },
      });
      expect(cache.indexes).not.toBe(null);

      cache.flush();

      expect(cache.indexes).toBe(null);
      expect(cache.getIndex()).toEqual({});
    });

    it('resets the version registry', () => {
      const cache = createMemoryCache();
      cache.putVersion('test', 1);

      expect(cache.getVersions()).toEqual({ test: 1 });
      expect(cache.versions).not.toBe(null);

      cache.flush();

      expect(cache.versions).toBe(null);
      expect(cache.getVersions()).toEqual({});
    });
  }); // describe: #flush
});
