const assert = require('chai').assert;
const sinon = require('sinon');
const Swell = require('./client');

describe('Client', function() {
  let serverConnectStub;

  before(function() {
    serverConnectStub = sinon.stub(Swell.Connection.prototype, 'connect');
  });
  beforeEach(function() {
    serverConnectStub.reset();
  });
  after(function() {
    serverConnectStub.restore();
  });

  describe('#constructor', function() {
    let initStub;
    let connectStub;

    before(function() {
      initStub = sinon.stub(Swell.Client.prototype, 'init');
      connectStub = sinon.stub(Swell.Client.prototype, 'connect');
    });

    beforeEach(function() {
      initStub.reset();
      connectStub.reset();
    });

    after(function() {
      initStub.restore();
      connectStub.restore();
    });

    it('construct without init', function() {
      new Swell.Client();

      assert.strictEqual(initStub.calledOnce, false);
      assert.strictEqual(connectStub.called, false);
    });

    it('init with options - callback', function() {
      new Swell.Client('id', 'key', {});

      assert.strictEqual(initStub.calledOnce, true);
      assert.strictEqual(initStub.args[0][0], 'id');
      assert.strictEqual(initStub.args[0][1], 'key');
      assert.deepEqual(initStub.args[0][2], {});
      assert.strictEqual(connectStub.called, false);
    });

    it('init with options + callback', function() {
      new Swell.Client('id', 'key', {}, function() {});

      assert.strictEqual(initStub.calledOnce, true);
      assert.strictEqual(connectStub.called, true);
    });
  });

  describe('#init', function() {
    let client;
    let testParams;

    beforeEach(function() {
      client = new Swell.Client();

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
        cache: true,
      };
    });

    it('initialize params with defaults', function() {
      client.init('id', 'key');

      assert.strictEqual(client.params.clientId, 'id');
      assert.strictEqual(client.params.clientKey, 'key');
      assert.deepEqual(client.params, testParams);
    });

    it('initialize params without cache', function() {
      client = new Swell.Client('id', 'key', {
        cache: false,
      });

      assert.strictEqual(client.params.cache, false);
    });

    it('initialize params with options', function() {
      testParams.clientId = 'testId';
      testParams.clientKey = 'testKey';
      client.init({ id: 'testId', key: 'testKey' });

      assert.deepEqual(client.params, testParams);
    });

    it('initialize params with credentials + options', function() {
      testParams.clientId = 'id2';
      testParams.clientKey = 'key2';
      testParams.host = 'api2';
      client.init(testParams.clientId, testParams.clientKey, { host: testParams.host });

      assert.strictEqual(client.params.clientId, 'id2');
      assert.strictEqual(client.params.clientKey, 'key2');
      assert.deepEqual(client.params, testParams);
    });

    it('initialize params route', function() {
      client.init({
        id: 'id',
        key: 'key',
        route: { client: 'id2' },
      });

      assert.deepEqual(client.params.route, { client: 'id2' });
      assert.deepEqual(client.params.routeClientId, 'id2');
    });

    it('initialize throws without client id', function() {
      try {
        client.init();
      } catch (err) {
        assert(/required/.test(err));
      }
    });

    it('initialize throws without client key', function() {
      try {
        client.init('id');
      } catch (err) {
        assert(/required/.test(err));
      }
    });
  });

  describe('#connect', function() {
    let client;
    let serverSpy;

    before(function() {
      serverSpy = sinon.spy(Swell, 'Connection');
    });

    beforeEach(function() {
      client = new Swell.Client('id', 'key');
      serverSpy.reset();
    });

    after(function() {
      serverSpy.restore();
    });

    it('connect params', function() {
      client.connect();

      assert.strictEqual(serverSpy.called, true);
      assert.strictEqual(serverSpy.args[0][0], client.params.host);
      assert.strictEqual(serverSpy.args[0][1], client.params.port);
    });

    it('connect with callback', function() {
      client.connect(sinon.stub());

      assert.strictEqual(serverSpy.called, true);
      assert.strictEqual(serverConnectStub.called, true);
      assert.strictEqual(typeof serverSpy.args[0][3], 'function');
    });

    it('proxy connection events', function() {
      const onSpy = sinon.spy(Swell.Connection.prototype, 'on');
      client.connect();

      assert.strictEqual(onSpy.args[0][0], 'close');
      assert.strictEqual(onSpy.args[1][0], 'error');
      assert.strictEqual(onSpy.args[2][0], 'error.network');
      assert.strictEqual(onSpy.args[3][0], 'error.protocol');
      assert.strictEqual(onSpy.args[4][0], 'error.server');

      onSpy.restore();
    });
  });

  describe('#request', function() {
    let client;
    let serverSpy;
    let connectSpy;
    let respondStub;
    let serverRequestStub;

    before(function() {
      serverSpy = sinon.spy(Swell, 'Connection');
      connectSpy = sinon.spy(Swell.Client.prototype, 'connect');
      respondStub = sinon.spy(Swell.Client.prototype, 'respond');
      serverRequestStub = sinon.stub(Swell.Connection.prototype, 'request');
    });

    beforeEach(function() {
      client = new Swell.Client('id', 'key');
      serverSpy.reset();
      connectSpy.reset();
      respondStub.reset();
      serverRequestStub.reset();
    });

    after(function() {
      serverSpy.restore();
      connectSpy.restore();
      respondStub.restore();
      serverRequestStub.restore();
    });

    it('connect on first request', function() {
      client.request('get', 'url');
      client.request('get', 'url');

      assert(!!client.server);
      assert.strictEqual(connectSpy.calledOnce, true);
      assert.strictEqual(serverRequestStub.calledTwice, true);
    });

    it('init cache', function() {
      assert.isNull(client.cache);
      client.request('get', 'url');
      assert.ok(client.cache);
    });

    it('init without cache', function() {
      client = new Swell.Client('id', 'key', { cache: false });
      assert.isNull(client.cache);
      client.request('get', 'url');
      assert.isNull(client.cache);
    });

    it('build request headers - authed', function() {
      client.authed = true;
      client.request('get', 'url', 'data');

      assert.strictEqual(serverRequestStub.args[0][0], 'get');
      assert.strictEqual(serverRequestStub.args[0][1], 'url');
      assert.deepEqual(serverRequestStub.args[0][2], {
        $data: 'data',
      });
    });

    it('build request headers + authed', function() {
      client = new Swell.Client('id', 'key', {
        route: { client: 'id2' },
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
        $cached: {},
      });
    });

    it('build request headers with default data', function() {
      client.authed = true;
      client.request('get', 'url');

      assert.strictEqual(serverRequestStub.args[0][0], 'get');
      assert.strictEqual(serverRequestStub.args[0][1], 'url');
      assert.deepEqual(serverRequestStub.args[0][2], {
        $data: null,
      });
    });

    it('handle result $auth', function() {
      const authStub = sinon.stub(Swell.Client.prototype, 'auth');
      serverRequestStub.onCall(0).callsArgWith(3, {
        $auth: true,
      });
      client.request('get', 'url', 'data');

      assert.strictEqual(authStub.called, true);

      authStub.restore();
    });

    it('handle result $auth + $end retry', function() {
      const authStub = sinon.stub(Swell.Client.prototype, 'auth');
      const requestSpy = sinon.spy(Swell.Client.prototype, 'request');
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

    it('handle result response', function() {
      serverRequestStub.onCall(0).callsArgWith(3, {
        $status: 200,
        $data: 'success',
      });
      client.request('get', 'url', 'data');

      assert.strictEqual(respondStub.called, true);
      assert.deepEqual(respondStub.args[0][3], {
        $status: 200,
        $data: 'success',
      });
    });

    it('resolves promise', function() {
      serverRequestStub.onCall(0).callsArgWith(3, {
        $data: 'success',
      });

      return client.request('get', 'url', 'data').then(function(data) {
        assert.strictEqual(data, 'success');
      });
    });

    it('rejects promise with error', function() {
      serverRequestStub.onCall(0).callsArgWith(3, {
        $error: 'error',
      });

      return client.request('get', 'url', 'data').catch(function(err) {
        assert.strictEqual(err.message, 'error');
      });
    });

    it('calls back', function() {
      serverRequestStub.onCall(0).callsArgWith(3, {});

      let calledBack = false;
      return client
        .request('get', 'url', 'data', function() {
          calledBack = true;
        })
        .then(function() {
          assert.strictEqual(calledBack, true);
        });
    });

    it('resolves promised data (object)', function() {
      const data = {
        test1: Promise.resolve('hello'),
        test2: Promise.resolve('world'),
        test3: 'static',
      };

      return client.request('get', 'url', data).then(function() {
        assert.deepEqual(serverRequestStub.args[0][2].$data, {
          test1: 'hello',
          test2: 'world',
          test3: 'static',
        });
      });
    });

    it('resolves promised data (array)', function() {
      const data = [Promise.resolve('hello'), Promise.resolve('world'), 'static'];

      return client.request('get', 'url', data).then(function() {
        assert.deepEqual(serverRequestStub.args[0][2].$data, ['hello', 'world', 'static']);
      });
    });
  });

  describe('#respond', function() {
    let client;

    beforeEach(function() {
      client = new Swell.Client();
    });

    it('respond with object data', function() {
      const response = {
        $url: '/resource/foo',
        $data: {
          id: 1,
          name: 'foo',
        },
      };

      client.respond('get', 'url', null, response, function(err, result, headers) {
        assert(typeof result === 'object');
        assert.strictEqual(result.id, headers.$data.id);
        assert.strictEqual(result.name, headers.$data.name);
        assert.strictEqual(err, undefined);
        assert.strictEqual(this, client);
      });
    });

    it('respond with null data', function() {
      const response = {
        $data: null,
      };

      client.respond('get', 'url', null, response, function(err, data, headers) {
        assert.strictEqual(data, null);
        assert.strictEqual(headers.$data, null);
        assert.strictEqual(this, client);
      });
    });

    it('respond with error', function() {
      const response = {
        $error: 'Internal Server Error',
      };

      client.respond('get', 'url', null, response, function(err, data, headers) {
        assert.strictEqual(data, undefined);
        assert.strictEqual(err, headers.$error);
        assert.strictEqual(err, response.$error);
        assert.strictEqual(this, client);
      });
    });

    it('respond with nothing', function() {
      const response = null;

      client.respond('get', 'url', null, response, function(err, data, headers) {
        assert.strictEqual(err, 'Empty response from server');
        assert.strictEqual(data, undefined);
        assert.strictEqual(headers.$status, 500);
        assert.strictEqual(this, client);
      });
    });
  });

  describe('#get/put/post/delete', function() {
    let client;
    let requestStub;
    let requestArgs;

    before(function() {
      requestStub = sinon.stub(Swell.Client.prototype, 'request');
      requestArgs = ['url', 'data', 'callback'];
      client = new Swell.Client();
    });

    beforeEach(function() {
      requestStub.reset();
    });

    after(function() {
      requestStub.restore();
    });

    it('get request', function() {
      client.get.apply(client, requestArgs);

      assert.strictEqual(requestStub.calledOnce, true);
      assert.deepEqual(requestStub.args[0][0], 'get');
      assert.deepEqual(requestStub.args[0].slice(1), requestArgs);
    });

    describe('get request caching behaviour', function() {
      const returnValue = 'response';
      const getCacheResultStub = sinon
        .stub(Swell.Client.prototype, 'getCacheResult')
        .returns(Promise.resolve(returnValue));

      const client = new Swell.Client();
      client.cache = true;

      after(function() {
        getCacheResultStub.restore();
      });

      it('returns (error, response) when retrieving from cache', function() {
        let calledBack = false;

        return client
          .get('url', 'data', function(error, response) {
            assert.strictEqual(error, null);
            assert.strictEqual(response, returnValue);
            calledBack = true;
          })
          .then(function() {
            assert.strictEqual(calledBack, true);
          });
      });

      it('fires callback when no request params present (callback 2nd param)', function() {
        let calledBack = false;

        return client
          .get('url', function() {
            calledBack = true;
          })
          .then(function() {
            assert.strictEqual(calledBack, true);
          });
      });
    });

    it('put request', function() {
      client.put.apply(client, requestArgs);

      assert.strictEqual(requestStub.calledOnce, true);
      assert.deepEqual(requestStub.args[0][0], 'put');
      assert.deepEqual(requestStub.args[0].slice(1), requestArgs);
    });

    it('post request', function() {
      client.post.apply(client, requestArgs);

      assert.strictEqual(requestStub.calledOnce, true);
      assert.deepEqual(requestStub.args[0][0], 'post');
      assert.deepEqual(requestStub.args[0].slice(1), requestArgs);
    });

    it('delete request', function() {
      client.delete.apply(client, requestArgs);

      assert.strictEqual(requestStub.calledOnce, true);
      assert.deepEqual(requestStub.args[0][0], 'delete');
      assert.deepEqual(requestStub.args[0].slice(1), requestArgs);
    });
  });

  describe('#auth', function() {
    let client;
    let connectSpy;
    let serverRequestStub;

    before(function() {
      connectSpy = sinon.spy(Swell.Client.prototype, 'connect');
      serverRequestStub = sinon.stub(Swell.Connection.prototype, 'request');
    });

    beforeEach(function() {
      client = new Swell.Client('id', 'key');
      connectSpy.reset();
      serverRequestStub.reset();
    });

    after(function() {
      connectSpy.restore();
      serverRequestStub.restore();
    });

    it('connect on first request', function() {
      client.auth();
      client.auth();

      assert(!!client.server);
      assert.strictEqual(connectSpy.calledOnce, true);
      assert.strictEqual(serverRequestStub.calledTwice, true);
    });

    it('request nonce if not provided', function() {
      client.auth();

      assert.strictEqual(serverRequestStub.calledOnce, true);
      assert.strictEqual(serverRequestStub.args[0][0], 'auth');
      assert.strictEqual(typeof serverRequestStub.args[0][1], 'function');
    });

    it('request auth with credentials encrypted by nonce', function() {
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

  describe('#close', function() {
    it('close server connection', function() {
      const closeStub = sinon.stub(Swell.Connection.prototype, 'close');
      const client = new Swell.Client('id', 'key');
      client.connect();
      client.close();

      assert.strictEqual(closeStub.calledOnce, true);

      closeStub.restore();
    });
  });

  describe('#create', function() {
    it('return a new client instance', function() {
      const client = Swell.Client.create('id', 'key');

      assert(client instanceof Swell.Client);
      assert.strictEqual(client.params.clientId, 'id');
      assert.strictEqual(client.params.clientKey, 'key');
    });
  });

  describe('#createResource', function() {
    let client;

    before(function() {
      client = new Swell.Client();
    });

    it('return a new collection resource', function() {
      const result = {
        $data: {
          count: 1,
          results: [{}],
        },
      };
      const resource = Swell.Client.createResource('url', result, client);

      assert(resource instanceof Swell.Collection);
    });

    it('return a new record resource', function() {
      const result = {
        $data: {},
      };
      const resource = Swell.Client.createResource('url', result, client);

      assert(resource instanceof Swell.Record);
    });
  });
});
