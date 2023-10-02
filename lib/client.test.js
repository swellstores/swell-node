'use strict';

const Client = require('./client');
const Cache = require('./cache');
const Connection = require('./connection');

describe('Client', () => {
  let serverConnectStub;

  beforeEach(() => {
    serverConnectStub = jest
      .spyOn(Connection.prototype, 'connect')
      .mockImplementation(() => {});
  });

  describe('#constructor', () => {
    let initStub;
    let connectStub;

    beforeEach(() => {
      initStub = jest
        .spyOn(Client.prototype, 'init')
        .mockImplementation(() => {});
      connectStub = jest
        .spyOn(Client.prototype, 'connect')
        .mockImplementation(() => {});
    });

    it('construct without init', () => {
      new Client();

      expect(initStub).not.toHaveBeenCalled();
      expect(connectStub).not.toHaveBeenCalled();
    });

    it('init with options - callback', () => {
      new Client('id', 'key', {});

      expect(initStub).toHaveBeenCalledTimes(1);
      expect(initStub).toHaveBeenCalledWith('id', 'key', {});
      expect(connectStub).not.toHaveBeenCalled();
    });

    it('init with options + callback', () => {
      new Client('id', 'key', {}, () => {});

      expect(initStub).toHaveBeenCalledTimes(1);
      expect(initStub).toHaveBeenCalledWith('id', 'key', {});
      expect(connectStub).toHaveBeenCalledTimes(1);
    });
  });

  describe('#init', () => {
    let client;
    let testParams;

    beforeEach(() => {
      client = new Client();

      testParams = {
        clientId: 'id',
        clientKey: 'key',
        host: 'api.swell.store',
        port: 8443,
        verifyCert: true,
        version: 1,
        session: undefined,
        timeout: undefined,
        route: undefined,
        routeClientId: undefined,
        endClientId: 'id',
        cache: {},
        debug: false,
        maxConcurrent: undefined,
      };
    });

    it('initialize params with defaults', () => {
      client.init('id', 'key');

      expect(client.params).toEqual(testParams);
    });

    it('initialize params without cache', () => {
      client = new Client('id', 'key', {
        cache: false,
      });

      expect(client.params.cache).toBe(false);
    });

    it('initialize params with options', () => {
      testParams.clientId = 'testId';
      testParams.clientKey = 'testKey';
      client.init({ id: 'testId', key: 'testKey' });

      expect(client.params).toEqual({
        ...testParams,
        endClientId: 'testId',
      });
    });

    it('initialize params with credentials + options', () => {
      testParams.clientId = 'id2';
      testParams.clientKey = 'key2';
      testParams.host = 'api2';
      client.init(testParams.clientId, testParams.clientKey, {
        host: testParams.host,
      });

      expect(client.params).toEqual({
        ...testParams,
        endClientId: 'id2',
      });
    });

    it('initialize params route', () => {
      client.init({
        id: 'id',
        key: 'key',
        route: { client: 'id2' },
      });

      expect(client.params.route).toEqual({ client: 'id2' });
      expect(client.params.routeClientId).toEqual('id2');
    });

    it('initialize throws without client id', () => {
      expect(() => {
        client.init();
      }).toThrow(Error, 'Swell store `id` is required to connect');
    });

    it('initialize throws without client key', () => {
      expect(() => {
        client.init('id');
      }).toThrow(Error, 'Swell store `key` is required to connect');
    });
  });

  describe('#connect', () => {
    let client;

    beforeEach(() => {
      client = new Client('id', 'key');
    });

    it('connect params', () => {
      client.connect();

      expect(client.connection).toBeTruthy();
      expect(client.params.host).toEqual(client.connection.host);
      expect(client.params.port).toEqual(client.connection.port);
    });

    it('connect with callback', () => {
      client.connect(jest.fn());

      expect(serverConnectStub).toHaveBeenCalled();
    });

    it('proxy connection events', () => {
      const onSpy = jest.spyOn(Connection.prototype, 'on');
      client.connect();

      expect(onSpy).toHaveBeenNthCalledWith(1, 'close', expect.any(Function));
      expect(onSpy).toHaveBeenNthCalledWith(2, 'error', expect.any(Function));
      expect(onSpy).toHaveBeenNthCalledWith(
        3,
        'error.network',
        expect.any(Function),
      );
      expect(onSpy).toHaveBeenNthCalledWith(
        4,
        'error.protocol',
        expect.any(Function),
      );
      expect(onSpy).toHaveBeenNthCalledWith(
        5,
        'error.server',
        expect.any(Function),
      );
    });
  });

  describe('#request', () => {
    let client;
    let connectSpy;
    let respondSpy;
    let serverRequestStub;

    beforeEach(() => {
      client = new Client('id', 'key');

      connectSpy = jest.spyOn(Client.prototype, 'connect');
      respondSpy = jest.spyOn(Client.prototype, 'respond');
      serverRequestStub = jest
        .spyOn(Connection.prototype, 'request')
        .mockImplementation(() => {});
    });

    it('connect on first request', () => {
      client.request('get', 'url');
      client.request('get', 'url');

      expect(client.connection);
      expect(connectSpy).toHaveBeenCalledTimes(1);
      expect(serverRequestStub).toHaveBeenCalledTimes(2);
    });

    it('init cache', () => {
      expect(client.cache).toBe(null);
      client.request('get', 'url');
      expect(client.cache).toBeTruthy();
    });

    it('init without cache', () => {
      client = new Client('id', 'key', { cache: false });
      expect(client.cache).toBe(null);
      client.request('get', 'url');
      expect(client.cache).toBe(null);
    });

    it('build request headers - authed', () => {
      client.authed = true;
      client.request('get', 'url', 'data');

      expect(serverRequestStub).toHaveBeenCalledWith(
        'get',
        'url',
        { $data: 'data' },
        expect.any(Function),
      );
    });

    it('build request headers + authed', () => {
      client = new Client('id', 'key', {
        route: { client: 'id2' },
        session: 'session-id',
      });
      client.authed = false;
      client.request('get', 'url', 'data');

      expect(serverRequestStub).toHaveBeenCalledWith(
        'get',
        'url',
        {
          $client: 'id',
          $key: 'key',
          $data: 'data',
          $route: {
            client: 'id2',
          },
          $session: 'session-id',
        },
        expect.any(Function),
      );
    });

    it('build request headers with default data', () => {
      client.authed = true;
      client.request('get', 'url');

      expect(serverRequestStub).toHaveBeenCalledWith(
        'get',
        'url',
        { $data: null },
        expect.any(Function),
      );
    });

    it('handle result $auth', () => {
      const authStub = jest
        .spyOn(Client.prototype, 'auth')
        .mockImplementation();

      serverRequestStub.mockImplementationOnce(
        (_method, _url, _data, callback) => {
          callback({ $auth: true });
        },
      );

      client.request('get', 'url', 'data');

      expect(authStub).toHaveBeenCalled();
    });

    it('handle result $auth + $end retry', () => {
      const authStub = jest
        .spyOn(Client.prototype, 'auth')
        .mockImplementation(() => {});
      const requestSpy = jest.spyOn(Client.prototype, 'request');

      serverRequestStub.mockImplementationOnce(
        (_method, _url, _data, callback) => {
          callback({
            $auth: true,
            $end: true,
          });
        },
      );
      client.request('get', 'url', 'data');

      expect(authStub).not.toHaveBeenCalled();
      expect(requestSpy).toHaveBeenCalledTimes(2);
    });

    it('handle result response', () => {
      serverRequestStub.mockImplementationOnce(
        (_method, _url, _data, callback) => {
          callback({
            $status: 200,
            $data: 'success',
          });
        },
      );
      client.request('get', 'url', 'data');

      expect(respondSpy).toHaveBeenCalledWith(
        'get',
        'url',
        { $client: 'id', $data: 'data', $key: 'key' },
        { $status: 200, $data: 'success' },
        expect.any(Function),
      );
    });

    it('resolves promise', async () => {
      serverRequestStub.mockImplementationOnce(
        (_method, _url, _data, callback) => {
          callback({
            $status: 200,
            $data: 'success',
          });
        },
      );

      const data = await client.request('get', 'url', 'data');

      expect(data).toEqual('success');
    });

    it('rejects promise with error', () => {
      serverRequestStub.mockImplementationOnce(
        (_method, _url, _data, callback) => {
          callback({ $error: 'error' });
        },
      );

      return client.request('get', 'url', 'data').catch((err) => {
        expect(err.message).toEqual('error');
        expect(err.stack).toContain(__filename);
      });
    });

    it('calls back', async () => {
      serverRequestStub.mockImplementationOnce(
        (_method, _url, _data, callback) => {
          callback({});
        },
      );

      const callback = jest.fn();
      await client.request('get', 'url', 'data', callback);

      expect(callback).toHaveBeenCalled();
    });

    it('resolves promised data (object)', async () => {
      const data = {
        test1: Promise.resolve('hello'),
        test2: Promise.resolve('world'),
        test3: 'static',
      };

      await client.request('get', 'url', data);

      expect(serverRequestStub).toHaveBeenCalledWith(
        'get',
        'url',
        expect.objectContaining({
          $data: {
            test1: 'hello',
            test2: 'world',
            test3: 'static',
          },
        }),
        expect.any(Function),
      );
    });

    it('resolves promised data (array)', async () => {
      const data = [
        Promise.resolve('hello'),
        Promise.resolve('world'),
        'static',
      ];

      await client.request('get', 'url', data);

      expect(serverRequestStub).toHaveBeenCalledWith(
        'get',
        'url',
        expect.objectContaining({
          $data: ['hello', 'world', 'static'],
        }),
        expect.any(Function),
      );
    });
  });

  describe('#respond', () => {
    let client;

    beforeEach(() => {
      client = new Client();
    });

    it('respond with object data', (done) => {
      const response = {
        $url: '/resource/foo',
        $data: {
          id: 1,
          name: 'foo',
        },
      };

      client.respond(
        'get',
        'url',
        null,
        response,
        function (err, result, headers) {
          expect(typeof result).toEqual('object');
          expect(result.id).toEqual(headers.$data.id);
          expect(result.name).toEqual(headers.$data.name);
          expect(err).toBe(undefined);
          expect(this).toBe(client);

          done();
        },
      );
    });

    it('respond with null data', (done) => {
      const response = {
        $data: null,
      };

      client.respond(
        'get',
        'url',
        null,
        response,
        function (err, data, headers) {
          expect(data).toBe(null);
          expect(headers.$data).toBe(null);
          expect(this).toBe(client);

          done();
        },
      );
    });

    it('respond with error', (done) => {
      const response = {
        $error: 'Internal Server Error',
      };

      client.respond(
        'get',
        'url',
        null,
        response,
        function (err, data, headers) {
          expect(data).toBe(undefined);
          expect(err).toEqual(headers.$error);
          expect(err).toEqual(response.$error);
          expect(this).toBe(client);

          done();
        },
      );
    });

    it('respond with nothing', (done) => {
      const response = null;

      client.respond(
        'get',
        'url',
        null,
        response,
        function (err, data, headers) {
          expect(err).toEqual('Empty response from server');
          expect(data).toBe(undefined);
          expect(headers.$status).toEqual(500);
          expect(this).toBe(client);

          done();
        },
      );
    });
  });

  describe('#get/put/post/delete', () => {
    let client;
    let requestStub;
    let requestArgs;

    beforeEach(() => {
      requestStub = jest
        .spyOn(Client.prototype, 'request')
        .mockImplementation(() => {});
      requestArgs = ['url', 'data', 'callback'];
      client = new Client();
      client.authed = true;
    });

    it('get request', () => {
      client.get(...requestArgs);

      expect(requestStub).toHaveBeenCalledTimes(1);
      expect(requestStub).toHaveBeenCalledWith('get', ...requestArgs);
    });

    it('put request', () => {
      client.put(...requestArgs);

      expect(requestStub).toHaveBeenCalledTimes(1);
      expect(requestStub).toHaveBeenCalledWith('put', ...requestArgs);
    });

    it('post request', () => {
      client.post(...requestArgs);

      expect(requestStub).toHaveBeenCalledTimes(1);
      expect(requestStub).toHaveBeenCalledWith('post', ...requestArgs);
    });

    it('delete request', () => {
      client.delete(...requestArgs);

      expect(requestStub).toHaveBeenCalledTimes(1);
      expect(requestStub).toHaveBeenCalledWith('delete', ...requestArgs);
    });

    describe('get request caching behaviour', () => {
      const returnValue = 'response';
      let getCacheStub;
      let client;

      beforeEach(() => {
        client = new Client('id', 'key', { cache: true });
        client.cache = new Cache('id');
        client.authed = true;
        client.sentVersions = true;

        // simulate a cache hit
        getCacheStub = jest
          .spyOn(Cache.prototype, 'get')
          .mockImplementation(() => {
            return { $data: returnValue };
          });
      });

      it('returns (error, response, headers) when retrieving from cache', async () => {
        const { error, response, headers } = await new Promise((resolve) => {
          client.get('url', 'data', (error, response, headers) => {
            resolve({ error, response, headers });
          });
        });

        expect(error).toBe(null);
        expect(response).toEqual(returnValue);
        expect(headers).toEqual({ $data: returnValue });
      });

      it('fires callback when no request params present (callback 2nd param)', async () => {
        const { error, response, headers } = await new Promise((resolve) => {
          client.get('url', (error, response, headers) => {
            resolve({ error, response, headers });
          });
        });

        expect(error).toBe(null);
        expect(response).toEqual(returnValue);
        expect(headers).toEqual({ $data: returnValue });
      });

      it('returns the cached response on cache hit', async () => {
        const result = await client.get('url', 'data');

        expect(result).toEqual(returnValue);
        expect(getCacheStub).toHaveBeenCalledTimes(1);
        expect(getCacheStub).toHaveBeenCalledWith('url', 'data');
        expect(requestStub).not.toHaveBeenCalled();
      });

      it('sends a request on cache miss', async () => {
        // simulate a cache miss
        getCacheStub.mockImplementationOnce(() => {
          return null;
        });

        await client.get('url', 'data');

        expect(getCacheStub).toHaveBeenCalledTimes(1);
        expect(getCacheStub).toHaveBeenCalledWith('url', 'data');
        expect(requestStub).toHaveBeenCalledTimes(1);
        expect(requestStub).toHaveBeenCalledWith('get', 'url', 'data', undefined);
      });

      it('skips the cache if $nocache is specified', async () => {
        await client.get('url', { $nocache: true });

        expect(getCacheStub).not.toHaveBeenCalled();
        expect(requestStub).toHaveBeenCalledTimes(1);
        expect(requestStub).toHaveBeenCalledWith(
          'get',
          'url',
          { $nocache: true },
          undefined
        );
      });
    });
  });

  describe('#auth', () => {
    let client;
    let connectSpy;
    let serverRequestStub;

    beforeEach(() => {
      client = new Client('id', 'key');

      connectSpy = jest.spyOn(Client.prototype, 'connect');
      serverRequestStub = jest
        .spyOn(Connection.prototype, 'request')
        .mockImplementation(() => {});
    });

    it('connects on first request', () => {
      client.auth();
      client.auth();

      expect(client.connection).toBeTruthy();
      expect(connectSpy).toHaveBeenCalledTimes(1);
      expect(serverRequestStub).toHaveBeenCalledTimes(2);
    });

    it('request nonce if not provided', () => {
      client.auth();

      expect(serverRequestStub).toHaveBeenCalledTimes(1);
      expect(serverRequestStub).toHaveBeenCalledWith(
        'auth',
        expect.any(Function),
      );
    });

    it('request auth with credentials encrypted by nonce', () => {
      client.auth('nonce');

      expect(serverRequestStub).toHaveBeenCalledTimes(1);
      expect(serverRequestStub).toHaveBeenCalledWith(
        'auth',
        {
          $v: 1,
          client: 'id',
          key: 'db519c8947922ea94bdd541f8612f3fe',
        },
        expect.any(Function),
      );
    });
  });

  describe('#authWithKey', () => {
    let client;
    let connectSpy;
    let serverRequestStub;

    beforeEach(() => {
      client = new Client('id', 'key');

      connectSpy = jest.spyOn(Client.prototype, 'connect');
      serverRequestStub = jest
        .spyOn(Connection.prototype, 'request')
        .mockImplementation(() => {});
    });

    it('request auth with credentials', () => {
      client.authWithKey();

      expect(serverRequestStub).toHaveBeenCalledTimes(1);
      expect(serverRequestStub).toHaveBeenCalledWith(
        'auth',
        {
          $v: 1,
          client: 'id',
          key: 'key',
        },
        expect.any(Function),
      );
    });
  });

  describe('#sendCachedVersions', () => {
    let client;
    let getCacheStub;
    let serverRequestStub;

    beforeEach(() => {
      serverRequestStub = jest
        .spyOn(Connection.prototype, 'request')
        .mockImplementation((_action, _data, callback) => {
          callback();
        });
      getCacheStub = jest
        .spyOn(Cache.prototype, 'getVersions')
        .mockImplementation(() => {
          return { a: 1 };
        });

      client = new Client('id', 'key', { cache: true });
      client.cache = new Cache('id');
      client.sentVersions = false;

      client.connect();
    });

    it('send cached versions to server auth with credentials', () => {
      client.sendCachedVersions();

      expect(getCacheStub).toHaveBeenCalledTimes(1);
      expect(serverRequestStub).toHaveBeenCalledTimes(1);
      expect(serverRequestStub).toHaveBeenCalledWith(
        'cached',
        {
          $cached: { a: 1 },
          $push: true,
        },
        expect.any(Function),
      );

      expect(client.sentVersions).toBe(true);
    });
  });

  describe('#setAuthedEnv', () => {
    let client;

    beforeEach(() => {
      client = new Client('id', 'key', { cache: true });
      client.cache = new Cache('id');
    });

    it('sets authed and env flags', () => {
      client.setAuthedEnv({ $env: 'test' });

      expect(client.authed).toBe(true);
      expect(client.env).toEqual('test');
      expect(client.cache.env).toEqual('test');
    });

    it('sets authed and env flags', () => {
      client.setAuthedEnv({});

      expect(client.authed).toBe(true);
      expect(client.env).toBe(undefined);
      expect(client.cache.env).toBe(undefined);
    });
  });

  describe('#onPush', () => {
    let client;

    describe('when caching is enabled', () => {
      beforeEach(() => {
        client = new Client('id', 'key', { cache: true });
        client.cache = new Cache('id');

        client.cache.put(
          '/foo',
          {},
          {
            $data: 'fooData',
            $collection: 'foo',
            $cached: { foo: 1 },
          },
        );

        client.cache.put(
          '/bar',
          {},
          {
            $data: 'barData',
            $collection: 'bar',
            $cached: { bar: 2 },
          },
        );

        expect(client.cache.getVersions()).toEqual({ foo: 1, bar: 2 });
        expect(client.cache.get('/foo', {})).toEqual({
          $cached: true,
          $collection: 'foo',
          $data: 'fooData',
        });
        expect(client.cache.get('/bar', {})).toEqual({
          $cached: true,
          $collection: 'bar',
          $data: 'barData',
        });
      });

      it('invalidates a cached collection entry', () => {
        client.onPush({ $cached: { foo: 2 } });

        // Only the "bar" entry should be cached.
        expect(client.cache.getVersions()).toEqual({ foo: 2, bar: 2 });
        expect(client.cache.get('/foo', {})).toBe(null);
        expect(client.cache.get('/bar', {})).toEqual({
          $cached: true,
          $collection: 'bar',
          $data: 'barData',
        });
      });
    }); // describe: when caching is enabled
  }); // describe: #onPush

  describe('#close', () => {
    it('close server connection', () => {
      const closeSpy = jest.spyOn(Connection.prototype, 'close');

      const client = new Client('id', 'key');
      client.connect();
      client.close();

      expect(closeSpy).toHaveBeenCalledTimes(1);
    });

    describe('#on close', () => {
      it('should listen for close when emitted by connection', () => {
        const client = new Client('id', 'key');
        client.connect();

        let calledClose = false;
        client.on('close', () => (calledClose = true));

        client.connection.close();

        expect(calledClose).toBe(true);
      });

      it('should emit an error when emitted by connection', () => {
        const client = new Client('id', 'key');
        client.connect();

        let calledError = null;
        client.on('error', (msg) => (calledError = msg));

        client.connection.error(null, 'Test error');

        expect(calledError).toEqual('Error: Test error');
      });
    });
  });

  describe('#create', () => {
    it('return a new client instance', () => {
      const client = Client.create('id', 'key');

      expect(client instanceof Client).toBe(true);
      expect(client.params.clientId).toEqual('id');
      expect(client.params.clientKey).toEqual('key');
    });
  });
});
