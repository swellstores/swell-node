'use strict';

const { assert } = require('chai');
const sinon = require('sinon');

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
      assert.deepEqual(cache.params, {
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
      assert.deepEqual(cache.params, {
        clientId: 'test',
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
  }); // describe: #constructor

  describe('#get', () => {
    let cache;

    beforeEach(() => {
      cache = createMemoryCache();
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
  }); // describe: #get

  describe('#getKey', () => {
    it('returns a predictable key for request args', () => {
      const cache = createMemoryCache();
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
  }); // describe: #getKey

  describe('#getPath', () => {
    it('returns a cache path with arg', () => {
      const cache = createMemoryCache();
      const path = cache.getPath('index');
      assert.equal(path, '/client.test.index');
    });

    it('returns a cache path with multiple args', () => {
      const cache = createMemoryCache();
      const path = cache.getPath('result', '12345');
      assert.equal(path, '/client.test.result.12345');
    });

    it('returns a cache path with path param prepended', () => {
      const cache = createMemoryCache({ path: '/test' });
      const path = cache.getPath('result', '12345');
      assert.equal(path, '/test/client.test.result.12345');
    });

    it('adds env to the cache path', () => {
      const cache = createMemoryCache({ env: 'env-name' });
      const path = cache.getPath('index');
      assert.equal(path, '/client.test_env-name.index');
    });
  }); // describe: #getPath

  describe('#getVersions', () => {
    it('sets and returns version cache', () => {
      const cache = createMemoryCache();
      assert.isUndefined(cache.versions);
      const versions = cache.getVersions();
      assert.deepEqual(versions, {});
    });

    it('sets and returns version cached earlier', () => {
      const cache = createMemoryCache();
      cache.putVersion('test', 1);
      const versions = cache.getVersions();
      assert.ok(cache.versions === versions);
      assert.deepEqual(versions, {
        test: 1,
      });
    });

    it('version object is cloned on each call and not mutated', () => {
      const cache = createMemoryCache();
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
  }); // describe: #getVersions

  describe('#getIndex', () => {
    it('sets and returns index cache', () => {
      const cache = createMemoryCache();
      assert.isNull(cache.indexes);
      const indexes = cache.getIndex();
      assert.deepEqual(indexes, {});
    });

    it('sets and returns index cached earlier', () => {
      const cache = createMemoryCache();
      cache.putIndex('test', '12345', 100);
      const indexes = cache.getIndex();
      assert.ok(cache.indexes === indexes);
      assert.deepEqual(indexes, {
        test: { '12345': 100 },
      });
    });

    it('gets a new index on each call', () => {
      const cache = createMemoryCache();
      cache.putIndex('test', '12345', 100);
      const index1 = cache.getIndex();
      const index2 = cache.getIndex();
      assert.isTrue(index1 !== index2);
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
  }); // describe: #put

  describe('#putIndex', () => {
    it('sets index cache with collection version and size', () => {
      const cache = createMemoryCache();
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
      const cache = createMemoryCache();
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
      assert.deepEqual(cache.get('/', {}), {
        $data: 'foo',
        $collection: 'bar',
        $cached: true,
      });
      cache.remove('/', {});
      assert.deepEqual(cache.get('/', {}), null);
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

      assert.deepEqual(cache.get('/test1', {}), {
        $data: 'foo',
        $collection: 'bar',
        $cached: true,
      });
      assert.deepEqual(cache.get('/test2', {}), {
        $data: 'foo',
        $collection: 'bar',
        $cached: true,
      });

      cache.flush();

      assert.isNull(cache.get('/test1', {}));
      assert.isNull(cache.get('/test1', {}));
    });

    it('resets the collection index registry', () => {
      const cache = createMemoryCache();
      cache.putIndex('test', '12345', 100);

      assert.deepEqual(cache.getIndex(), {
        test: { '12345': 100 },
      });

      cache.flush();

      assert.deepEqual(cache.getIndex(), {});
    });

    it('resets the version registry', () => {
      const cache = createMemoryCache();
      cache.putVersion('test', 1);

      assert.deepEqual(cache.getVersions(), {
        test: 1
      });

      cache.flush();

      assert.deepEqual(cache.getVersions(), {});
    });
  }); // describe: #flush
});
