const assert = require('chai').assert;
const sinon = require('sinon');
const Client = require('./client');
const Cache = require('./cache');
const Connection = require('./connection');

describe('Client', () => {
  let serverConnectStub = sinon.stub(Connection.prototype, 'connect');

  beforeEach(() => {
    serverConnectStub.reset();
  });

  afterAll(() => {
    serverConnectStub.restore();
  });

  describe('#constructor', () => {
    let initStub = sinon.stub(Client.prototype, 'init');
    let connectStub = sinon.stub(Client.prototype, 'connect');

    beforeEach(() => {
      initStub.reset();
      connectStub.reset();
    });

    afterAll(() => {
      initStub.restore();
      connectStub.restore();
    });

    it('construct without init', () => {
      new Client();

      assert.strictEqual(initStub.calledOnce, false);
      assert.strictEqual(connectStub.called, false);
    });

    it('init with options - callback', () => {
      new Client('id', 'key', {});

      assert.strictEqual(initStub.calledOnce, true);
      assert.strictEqual(initStub.args[0][0], 'id');
      assert.strictEqual(initStub.args[0][1], 'key');
      assert.deepEqual(initStub.args[0][2], {});
      assert.strictEqual(connectStub.called, false);
    });

    it('init with options + callback', () => {
      new Client('id', 'key', {}, () => {});

      assert.strictEqual(initStub.calledOnce, true);
      assert.strictEqual(connectStub.called, true);
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
        cache: true,
        debug: false,
      };
    });

    it('initialize params with defaults', () => {
      client.init('id', 'key');

      assert.strictEqual(client.params.clientId, 'id');
      assert.strictEqual(client.params.clientKey, 'key');
      assert.deepEqual(client.params, testParams);
    });

    it('initialize params without cache', () => {
      client = new Client('id', 'key', {
        cache: false,
      });

      assert.strictEqual(client.params.cache, false);
    });

    it('initialize params with options', () => {
      testParams.clientId = 'testId';
      testParams.clientKey = 'testKey';
      client.init({ id: 'testId', key: 'testKey' });

      assert.deepEqual(client.params, {
        ...testParams,
        endClientId: 'testId',
      });
    });

    it('initialize params with credentials + options', () => {
      testParams.clientId = 'id2';
      testParams.clientKey = 'key2';
      testParams.host = 'api2';
      client.init(testParams.clientId, testParams.clientKey, { host: testParams.host });

      assert.strictEqual(client.params.clientId, 'id2');
      assert.strictEqual(client.params.clientKey, 'key2');
      assert.deepEqual(client.params, {
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

      assert.deepEqual(client.params.route, { client: 'id2' });
      assert.deepEqual(client.params.routeClientId, 'id2');
    });

    it('initialize throws without client id', () => {
      try {
        client.init();
      } catch (err) {
        assert(/required/.test(err));
      }
    });

    it('initialize throws without client key', () => {
      try {
        client.init('id');
      } catch (err) {
        assert(/required/.test(err));
      }
    });
  });

  describe('#connect', () => {
    let client;

    beforeEach(() => {
      client = new Client('id', 'key');
    });

    it('connect params', () => {
      client.connect();

      assert.ok(client.server);
      assert.strictEqual(client.params.host, client.server.host);
      assert.strictEqual(client.params.port, client.server.port);
    });

    it('connect with callback', () => {
      client.connect(sinon.stub());

      assert.strictEqual(serverConnectStub.called, true);
    });

    it('proxy connection events', () => {
      const onSpy = sinon.spy(Connection.prototype, 'on');
      client.connect();

      assert.strictEqual(onSpy.args[0][0], 'close');
      assert.strictEqual(onSpy.args[1][0], 'error');
      assert.strictEqual(onSpy.args[2][0], 'error.network');
      assert.strictEqual(onSpy.args[3][0], 'error.protocol');
      assert.strictEqual(onSpy.args[4][0], 'error.server');

      onSpy.restore();
    });
  });

  describe('#request', () => {
    let client;
    let connectSpy;
    let respondSpy;
    let serverRequestStub;

    beforeAll(() => {
      connectSpy = sinon.spy(Client.prototype, 'connect');
      respondSpy = sinon.spy(Client.prototype, 'respond');
      serverRequestStub = sinon.stub(Connection.prototype, 'request');
    });

    beforeEach(() => {
      client = new Client('id', 'key');
      connectSpy.resetHistory();
      respondSpy.resetHistory();
      serverRequestStub.reset();
    });

    afterAll(() => {
      connectSpy.restore();
      respondSpy.restore();
      serverRequestStub.restore();
    });

    it('connect on first request', () => {
      client.request('get', 'url');
      client.request('get', 'url');

      assert(!!client.server);
      assert.strictEqual(connectSpy.calledOnce, true);
      assert.strictEqual(serverRequestStub.calledTwice, true);
    });

    it('init cache', () => {
      assert.isNull(client.cache);
      client.request('get', 'url');
      assert.ok(client.cache);
    });

    it('init without cache', () => {
      client = new Client('id', 'key', { cache: false });
      assert.isNull(client.cache);
      client.request('get', 'url');
      assert.isNull(client.cache);
    });

    it('build request headers - authed', () => {
      client.authed = true;
      client.request('get', 'url', 'data');

      assert.strictEqual(serverRequestStub.args[0][0], 'get');
      assert.strictEqual(serverRequestStub.args[0][1], 'url');
      assert.deepEqual(serverRequestStub.args[0][2], {
        $data: 'data',
      });
    });

    it('build request headers + authed', () => {
      client = new Client('id', 'key', {
        route: { client: 'id2' },
        session: 'session-id',
      });
      client.authed = false;
      client.request('get', 'url', 'data');

      assert.strictEqual(serverRequestStub.args[0][0], 'get');
      assert.strictEqual(serverRequestStub.args[0][1], 'url');
      assert.deepEqual(serverRequestStub.args[0][2], {
        $client: 'id',
        $key: 'key',
        $data: 'data',
        $route: {
          client: 'id2',
        },
        $session: 'session-id',
        $cached: {},
        $push: true,
      });
    });

    it('build request headers with default data', () => {
      client.authed = true;
      client.request('get', 'url');

      assert.strictEqual(serverRequestStub.args[0][0], 'get');
      assert.strictEqual(serverRequestStub.args[0][1], 'url');
      assert.deepEqual(serverRequestStub.args[0][2], {
        $data: null,
      });
    });

    it('handle result $auth', () => {
      const authStub = sinon.stub(Client.prototype, 'auth');
      serverRequestStub.onCall(0).callsArgWith(3, {
        $auth: true,
      });
      client.request('get', 'url', 'data');

      assert.strictEqual(authStub.called, true);

      authStub.restore();
    });

    it('handle result $auth + $end retry', () => {
      const authStub = sinon.stub(Client.prototype, 'auth');
      const requestSpy = sinon.spy(Client.prototype, 'request');
      serverRequestStub.onCall(0).callsArgWith(3, {
        $auth: true,
        $end: true,
      });
      client.request('get', 'url', 'data');

      assert.strictEqual(authStub.called, false);
      assert.strictEqual(requestSpy.calledTwice, true);

      authStub.restore();
      requestSpy.restore();
    });

    it('handle result response', () => {
      serverRequestStub.onCall(0).callsArgWith(3, {
        $status: 200,
        $data: 'success',
      });
      client.request('get', 'url', 'data');

      assert.strictEqual(respondSpy.called, true);
      assert.deepEqual(respondSpy.args[0][3], {
        $status: 200,
        $data: 'success',
      });
    });

    it('resolves promise', () => {
      serverRequestStub.onCall(0).callsArgWith(3, {
        $data: 'success',
      });

      return client.request('get', 'url', 'data').then(function (data) {
        assert.strictEqual(data, 'success');
      });
    });

    it('rejects promise with error', () => {
      serverRequestStub.onCall(0).callsArgWith(3, {
        $error: 'error',
      });

      return client.request('get', 'url', 'data').catch(function (err) {
        assert.strictEqual(err.message, 'error');

        assert.include(err.stack, __filename);
      });
    });

    it('calls back', () => {
      serverRequestStub.onCall(0).callsArgWith(3, {});

      let calledBack = false;
      return client
        .request('get', 'url', 'data', () => {
          calledBack = true;
        })
        .then(() => {
          assert.strictEqual(calledBack, true);
        });
    });

    it('resolves promised data (object)', () => {
      const data = {
        test1: Promise.resolve('hello'),
        test2: Promise.resolve('world'),
        test3: 'static',
      };

      return client.request('get', 'url', data).then(() => {
        assert.deepEqual(serverRequestStub.args[0][2].$data, {
          test1: 'hello',
          test2: 'world',
          test3: 'static',
        });
      });
    });

    it('resolves promised data (array)', () => {
      const data = [Promise.resolve('hello'), Promise.resolve('world'), 'static'];

      return client.request('get', 'url', data).then(() => {
        assert.deepEqual(serverRequestStub.args[0][2].$data, ['hello', 'world', 'static']);
      });
    });
  });

  describe('#respond', () => {
    let client;

    beforeEach(() => {
      client = new Client();
    });

    it('respond with object data', () => {
      const response = {
        $url: '/resource/foo',
        $data: {
          id: 1,
          name: 'foo',
        },
      };

      client.respond('get', 'url', null, response, function (err, result, headers) {
        assert(typeof result === 'object');
        assert.strictEqual(result.id, headers.$data.id);
        assert.strictEqual(result.name, headers.$data.name);
        assert.strictEqual(err, undefined);
        assert.strictEqual(this, client);
      });
    });

    it('respond with null data', () => {
      const response = {
        $data: null,
      };

      client.respond('get', 'url', null, response, function (err, data, headers) {
        assert.strictEqual(data, null);
        assert.strictEqual(headers.$data, null);
        assert.strictEqual(this, client);
      });
    });

    it('respond with error', () => {
      const response = {
        $error: 'Internal Server Error',
      };

      client.respond('get', 'url', null, response, function (err, data, headers) {
        assert.strictEqual(data, undefined);
        assert.strictEqual(err, headers.$error);
        assert.strictEqual(err, response.$error);
        assert.strictEqual(this, client);
      });
    });

    it('respond with nothing', () => {
      const response = null;

      client.respond('get', 'url', null, response, function (err, data, headers) {
        assert.strictEqual(err, 'Empty response from server');
        assert.strictEqual(data, undefined);
        assert.strictEqual(headers.$status, 500);
        assert.strictEqual(this, client);
      });
    });
  });

  describe('#get/put/post/delete', () => {
    let client;
    let requestStub;
    let requestArgs;

    beforeEach(() => {
      requestStub = sinon.stub(Client.prototype, 'request');
      requestArgs = ['url', 'data', 'callback'];
      client = new Client();
    });

    afterEach(() => {
      requestStub.restore();
    });

    it('get request', () => {
      client.get.apply(client, requestArgs);

      assert.strictEqual(requestStub.calledOnce, true);
      assert.deepEqual(requestStub.args[0][0], 'get');
      assert.deepEqual(requestStub.args[0].slice(1), requestArgs);
    });

    it('put request', () => {
      client.put.apply(client, requestArgs);

      assert.strictEqual(requestStub.calledOnce, true);
      assert.deepEqual(requestStub.args[0][0], 'put');
      assert.deepEqual(requestStub.args[0].slice(1), requestArgs);
    });

    it('post request', () => {
      client.post.apply(client, requestArgs);

      assert.strictEqual(requestStub.calledOnce, true);
      assert.deepEqual(requestStub.args[0][0], 'post');
      assert.deepEqual(requestStub.args[0].slice(1), requestArgs);
    });

    it('delete request', () => {
      client.delete.apply(client, requestArgs);

      assert.strictEqual(requestStub.calledOnce, true);
      assert.deepEqual(requestStub.args[0][0], 'delete');
      assert.deepEqual(requestStub.args[0].slice(1), requestArgs);
    });

    describe('get request caching behaviour', () => {
      const returnValue = 'response';
      let getCacheStub;
      let client;

      beforeEach(() => {
        client = new Client('id', 'key', { cache: true });
        client.cache = new Cache('id');
        client.authed = true;
        client.request.restore();
        getCacheStub = sinon.stub(Cache.prototype, 'get').returns({ $data: returnValue });
      });

      afterEach(() => {
        getCacheStub.restore();
      });

      it('returns (error, response, headers) when retrieving from cache', () => {
        let calledBack = false;

        return client
          .get('url', 'data', function (error, response, headers) {
            assert.strictEqual(error, null);
            assert.strictEqual(response, returnValue);
            assert.deepEqual(headers, { $data: returnValue });
            calledBack = true;
          })
          .then(() => {
            assert.strictEqual(calledBack, true);
          });
      });

      it('fires callback when no request params present (callback 2nd param)', () => {
        let calledBack = false;

        return client
          .get('url', () => {
            calledBack = true;
          })
          .then(() => {
            assert.strictEqual(calledBack, true);
          });
      });
    });
  });

  describe('#auth', () => {
    let client;
    let connectSpy;
    let serverRequestStub;

    beforeAll(() => {
      connectSpy = sinon.spy(Client.prototype, 'connect');
      serverRequestStub = sinon.stub(Connection.prototype, 'request');
    });

    beforeEach(() => {
      client = new Client('id', 'key');
      connectSpy.resetHistory();
      serverRequestStub.reset();
    });

    afterAll(() => {
      connectSpy.restore();
      serverRequestStub.restore();
    });

    it('connect on first request', () => {
      client.auth();
      client.auth();

      assert(!!client.server);
      assert.strictEqual(connectSpy.calledOnce, true);
      assert.strictEqual(serverRequestStub.calledTwice, true);
    });

    it('request nonce if not provided', () => {
      client.auth();

      assert.strictEqual(serverRequestStub.calledOnce, true);
      assert.strictEqual(serverRequestStub.args[0][0], 'auth');
      assert.strictEqual(typeof serverRequestStub.args[0][1], 'function');
    });

    it('request auth with credentials encrypted by nonce', () => {
      client.auth('nonce');

      assert.strictEqual(serverRequestStub.calledOnce, true);
      assert.strictEqual(serverRequestStub.args[0][0], 'auth');
      assert.deepEqual(serverRequestStub.args[0][1], {
        $v: 1,
        client: 'id',
        key: 'db519c8947922ea94bdd541f8612f3fe',
      });
    });
  });

  describe('#close', () => {
    let closeStub;

    beforeEach(() => {
      closeStub = sinon.stub(Connection.prototype, 'close');
    });

    afterEach(() => {
      closeStub.restore();
    });

    it('close server connection', () => {
      const client = new Client('id', 'key');
      client.connect();
      client.close();

      assert.strictEqual(closeStub.calledOnce, true);
    });

    describe('#on close', () => {
      it('should listen for close when emitted by connection', () => {
        const client = new Client('id', 'key');
        client.connect();

        closeStub.restore();

        let calledClose = false;
        client.on('close', () => (calledClose = true));

        client.server.close();

        assert.strictEqual(calledClose, true);
      });

      it('should emit an error when emitted by connection', () => {
        const client = new Client('id', 'key');
        client.connect();

        let calledError = null;
        client.on('error', (msg) => (calledError = msg));

        client.server.error(null, 'Test error');

        assert.strictEqual(calledError, 'Error: Test error');
      });
    });
  });

  describe('#create', () => {
    it('return a new client instance', () => {
      const client = Client.create('id', 'key');

      assert(client instanceof Client);
      assert.strictEqual(client.params.clientId, 'id');
      assert.strictEqual(client.params.clientKey, 'key');
    });
  });
});
