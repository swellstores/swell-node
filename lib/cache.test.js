const assert = require('chai').assert;
const sinon = require('sinon');
const Cache = require('./cache').Cache;

describe('Cache', function() {
  describe('#constructor', function() {
    it('builds params from defaults', function() {
      const cache = new Cache('test', {});
      assert.deepEqual(cache.params, {
        clientId: 'test',
        path: '',
        storage: 'memory',
        writePerms: '0644',
        indexLimit: 1000,
      });
    });

    it('builds params from options', function() {
      const cache = new Cache('test', {
        path: '/',
        storage: 'memory',
        writePerms: '1234',
        indexLimit: 1,
      });
      assert.deepEqual(cache.params, {
        clientId: 'test',
        path: '/',
        storage: 'memory',
        writePerms: '1234',
        indexLimit: 1,
      });
    });

    it('throws an error on invalid storage', function() {
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

  describe('#get', function() {
    let cache;

    beforeEach(function() {
      cache = new Cache('test');
    });

    it('returns null when cache index not found', function() {
      const result = cache.get('/', {});
      assert.isNull(result);
    });

    it('returns response object when cache index found', function() {
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
  });

  describe('#getKey', function() {
    it('returns a predictable key for request args', function() {
      const cache = new Cache('test');
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

  describe('#getPath', function() {
    it('returns a cache path with arg', function() {
      const cache = new Cache('test');
      const path = cache.getPath('index');
      assert.equal(path, '/client.test.index');
    });

    it('returns a cache path with multiple args', function() {
      const cache = new Cache('test');
      const path = cache.getPath('result', '12345');
      assert.equal(path, '/client.test.result.12345');
    });

    it('returns a cache path with path param prepended', function() {
      const cache = new Cache('test', { path: '/test' });
      const path = cache.getPath('result', '12345');
      assert.equal(path, '/test/client.test.result.12345');
    });
  });

  describe('#getVersions', function() {
    it('sets and returns version cache', function() {
      const cache = new Cache('test');
      assert.isNull(cache.versions);
      const versions = cache.getVersions();
      assert.deepEqual(versions, {});
    });

    it('sets and returns version cached earlier', function() {
      const cache = new Cache('test');
      cache.putVersion('test', 1);
      const versions = cache.getVersions();
      assert.ok(cache.versions === versions);
      assert.deepEqual(versions, {
        test: 1,
      });
    });
  });

  describe('#getIndex', function() {
    it('sets and returns index cache', function() {
      const cache = new Cache('test');
      assert.isNull(cache.indexes);
      const indexes = cache.getIndex();
      assert.deepEqual(indexes, {});
    });

    it('sets and returns index cached earlier', function() {
      const cache = new Cache('test');
      cache.putIndex('test', '12345', 100);
      const indexes = cache.getIndex();
      assert.ok(cache.indexes === indexes);
      assert.deepEqual(indexes, {
        test: { '12345': 100 },
      });
    });
  });

  describe('#put', function() {
    let cache, response;

    beforeEach(function() {
      cache = new Cache('test');
      response = {
        $data: 'foo',
        $collection: 'bar',
        $cached: { bar: 1 },
      };
    });

    it('sets index, version and result cache', function() {
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

  describe('#putIndex', function() {
    it('sets index cache with collection version and size', function() {
      const cache = new Cache('test');
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

    it('resets existing item in index cache', function() {
      const cache = new Cache('test');
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

  describe('#remove', function() {
    it('removes an entry from result cache', function() {
      const cache = new Cache('test');
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
