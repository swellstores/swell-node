const assert = require('chai').assert;
const sinon = require('sinon');
const Cache = require('./cache');

const CreateMemoryCache = (options = {}) => {
  return new Cache('test', {
    storage: 'memory',
    ...options,
  });
};

describe('Cache', () => {
  describe('#constructor', () => {
    it('builds params from defaults', () => {
      const cache = new Cache('test', {});
      assert.deepEqual(cache.params, {
        clientId: 'test',
        env: undefined,
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
      assert.deepEqual(cache.params, {
        clientId: 'test',
        env: undefined,
        path: '/',
        storage: 'memory',
        indexLimit: 1,
      });
    });

    it('throws an error on invalid storage', () => {
      try {
        const cache = new Cache('test', {
          storage: 'fail',
        });
        assert.fail('oops');
      } catch (err) {
        assert.equal(err.message, 'fail storage is not currently supported');
      }
    });
  });

  describe('#get', () => {
    let cache;

    beforeEach(() => {
      cache = CreateMemoryCache();
    });

    it('returns null when cache index not found', () => {
      const result = cache.get('/', {});
      assert.isNull(result);
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
      assert.deepEqual(result, {
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
      assert.deepEqual(result, {
        $data: { test: 1 },
        $collection: 'bar',
        $cached: true,
      });
    });
  });

  describe('#getKey', () => {
    it('returns a predictable key for request args', () => {
      const cache = CreateMemoryCache();
      const key1 = cache.getKey('/test1', true);
      const key2 = cache.getKey('/test1', true);
      const key3 = cache.getKey('/test1', false);
      const key4 = cache.getKey('/other');
      const key5 = cache.getKey(' other/ ', null);
      assert.ok(key1 && key2 && key3 && key4 && key5);
      assert.equal(key1, key2);
      assert.notEqual(key1, key3);
      assert.notEqual(key1, key4);
      assert.equal(key4, key5);
    });
  });

  describe('#getPath', () => {
    it('returns a cache path with arg', () => {
      const cache = CreateMemoryCache();
      const path = cache.getPath('index');
      assert.equal(path, '/client.test.index');
    });

    it('returns a cache path with multiple args', () => {
      const cache = CreateMemoryCache();
      const path = cache.getPath('result', '12345');
      assert.equal(path, '/client.test.result.12345');
    });

    it('returns a cache path with path param prepended', () => {
      const cache = CreateMemoryCache({ path: '/test' });
      const path = cache.getPath('result', '12345');
      assert.equal(path, '/test/client.test.result.12345');
    });

    it('adds env to the cache path', () => {
      const cache = CreateMemoryCache({ env: 'env-name' });
      const path = cache.getPath('index');
      assert.equal(path, '/client.test.env-name.index');
    })
  });

  describe('#getVersions', () => {
    it('sets and returns version cache', () => {
      const cache = CreateMemoryCache();
      assert.isNull(cache.versions);
      const versions = cache.getVersions();
      assert.deepEqual(versions, {});
    });

    it('sets and returns version cached earlier', () => {
      const cache = CreateMemoryCache();
      cache.putVersion('test', 1);
      const versions = cache.getVersions();
      assert.ok(cache.versions === versions);
      assert.deepEqual(versions, {
        test: 1,
      });
    });

    it('version object is cloned on each call and not mutated', () => {
      const cache = CreateMemoryCache();
      cache.putVersion('test', 1);
      const versions = cache.getVersions();
      assert.ok(cache.versions === versions);
      assert.deepEqual(versions, {
        test: 1,
      });
      const versions2 = cache.getVersions();
      versions.test = 2;
      assert.deepEqual(versions2, {
        test: 1,
      });
    });
  });

  describe('#getIndex', () => {
    it('sets and returns index cache', () => {
      const cache = CreateMemoryCache();
      assert.isNull(cache.indexes);
      const indexes = cache.getIndex();
      assert.deepEqual(indexes, {});
    });

    it('sets and returns index cached earlier', () => {
      const cache = CreateMemoryCache();
      cache.putIndex('test', '12345', 100);
      const indexes = cache.getIndex();
      assert.ok(cache.indexes === indexes);
      assert.deepEqual(indexes, {
        test: { '12345': 100 },
      });
    });

    it('gets a new index on each call', () => {
      const cache = CreateMemoryCache();
      cache.putIndex('test', '12345', 100);
      const index1 = cache.getIndex();
      const index2 = cache.getIndex();
      assert.isTrue(index1 !== index2);
    });
  });

  describe('#put', () => {
    let cache, response;

    beforeEach(() => {
      cache = CreateMemoryCache();
      response = {
        $data: 'foo',
        $collection: 'bar',
        $cached: { bar: 1 },
      };
    });

    it('sets index, version and result cache', () => {
      cache.put('/', {}, response);
      assert.deepEqual(cache.getIndex(), {
        bar: { '58cd6550e4fe03ea78ee22cf52c759b7': 50 },
      });
      assert.deepEqual(cache.getVersions(), {
        bar: 1,
      });
      assert.deepEqual(cache.get('/', {}), {
        $data: 'foo',
        $collection: 'bar',
        $cached: true,
      });
    });
  });

  describe('#putIndex', () => {
    it('sets index cache with collection version and size', () => {
      const cache = CreateMemoryCache();
      cache.putIndex('bar', '12345', 100);
      const indexes = cache.getIndex();
      assert.deepEqual(indexes, {
        bar: { '12345': 100 },
      });
      cache.putIndex('bar2', '123456', 1001);
      const indexes2 = cache.getIndex();
      assert.deepEqual(indexes2, {
        bar: { '12345': 100 },
        bar2: { '123456': 1001 },
      });
    });

    it('resets existing item in index cache', () => {
      const cache = CreateMemoryCache();
      cache.putIndex('bar', '12345', 100);
      const indexes = cache.getIndex();
      assert.deepEqual(indexes, {
        bar: { '12345': 100 },
      });
      cache.putIndex('bar', '12345', 1001);
      const indexes2 = cache.getIndex();
      assert.deepEqual(indexes2, {
        bar: { '12345': 1001 },
      });
    });
  });

  describe('#remove', () => {
    it('removes an entry from result cache', () => {
      const cache = CreateMemoryCache();
      cache.put(
        '/',
        {},
        {
          $data: 'foo',
          $collection: 'bar',
          $cached: { bar: 1 },
        },
      );
      assert.deepEqual(cache.get('/', {}), {
        $data: 'foo',
        $collection: 'bar',
        $cached: true,
      });
      cache.remove('/', {});
      assert.deepEqual(cache.get('/', {}), null);
    });
  });
});
