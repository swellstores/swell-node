import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';

import { Client, HttpMethod } from './client';

const mock = new MockAdapter(axios);

describe('Client', () => {
  describe('#constructor', () => {
    test('creates an instance without initialization', () => {
      const client = new Client();

      expect(client.options).toEqual({});
      expect(client.httpClient).toStrictEqual(null);
    });

    test('creates an instance with initialization', () => {
      const client = new Client('id', 'key', { timeout: 1000 });

      expect(client.options.timeout).toEqual(1000);
      expect(client.httpClient).toBeDefined();
    });
  }); // describe: #constructor

  describe('#createClient', () => {
    let client: Client;

    beforeEach(() => {
      client = new Client();
    });

    it('instantiates multiple clients', () => {
      const one = client.createClient('id', 'key1');
      expect(one instanceof Client).toBe(true);
      expect(one.httpClient?.defaults.headers.common['X-Header']).toBe(
        undefined,
      );

      const two = client.createClient('id', 'key2', {
        headers: { 'X-Header': 'Foo' },
      });
      expect(two instanceof Client).toBe(true);
      expect(two.httpClient?.defaults.headers.common['X-Header']).toEqual(
        'Foo',
      );
    });
  }); // describe: #createClient

  describe('#init', () => {
    let client: Client;

    beforeEach(() => {
      client = new Client();
    });

    test('throws an error if "id" is missing', () => {
      expect(() => {
        client.init();
      }).toThrow("Swell store 'id' is required to connect");
    });

    test('throws an error if "key" is missing', () => {
      expect(() => {
        client.init('id');
      }).toThrow("Swell store 'key' is required to connect");
    });

    test('applies default options when none are specified', () => {
      client.init('id', 'key');

      expect(client.options).toEqual({
        headers: {},
        url: 'https://api.swell.store',
        verifyCert: true,
        version: 1,
        retries: 0,
        maxSockets: 100,
        recycleAfterMs: 15000,
        recycleAfterRequests: 1000,
      });
    });

    test('overrides default options', () => {
      client.init('id', 'key', {
        verifyCert: false,
        version: 2,
        maxSockets: 101,
        recycleAfterMs: 15001,
        recycleAfterRequests: 1001,
      });

      expect(client.options).toEqual({
        headers: {},
        url: 'https://api.swell.store',
        verifyCert: false,
        version: 2,
        retries: 0,
        maxSockets: 101,
        recycleAfterMs: 15001,
        recycleAfterRequests: 1001,
      });
    });

    describe('concerning headers', () => {
      test('sets default content-type header', () => {
        client.init('id', 'key');
        expect(
          client.httpClient?.defaults.headers.common['Content-Type'],
        ).toEqual('application/json');
      });

      test('sets default user-agent header', () => {
        client.init('id', 'key');
        expect(
          client.httpClient?.defaults.headers.common['User-Agent'],
        ).toMatch(/^swell-node@.+$/);
      });

      test('sets default x-user-application header', () => {
        client.init('id', 'key');

        expect(
          client.httpClient?.defaults.headers.common['X-User-Application'],
        ).toEqual(
          `${process.env.npm_package_name}@${process.env.npm_package_version}`,
        );
      });

      test('sets authorization header', () => {
        client.init('id', 'key');

        const authToken: string = Buffer.from('id:key', 'utf8').toString(
          'base64',
        );

        expect(
          client.httpClient?.defaults.headers.common['Authorization'],
        ).toEqual(`Basic ${authToken}`);
      });

      test('passes in extra headers', () => {
        const headers = {
          'X-Header-1': 'foo',
          'X-Header-2': 'bar',
        };

        client.init('id', 'key', { headers });

        expect(
          client.httpClient?.defaults.headers.common['X-Header-1'],
        ).toEqual('foo');
        expect(
          client.httpClient?.defaults.headers.common['X-Header-2'],
        ).toEqual('bar');
      });
    }); // describe: concerning headers
  }); // describe: #init

  describe('#request', () => {
    test('makes a GET request', async () => {
      const client = new Client('id', 'key');

      mock.onGet('/products/:count').reply(200, 42);

      const response = await client.request(
        HttpMethod.get,
        '/products/:count',
        {},
      );

      expect(response).toEqual(42);
    });

    test('makes a POST request', async () => {
      const client = new Client('id', 'key');

      mock.onPost('/products').reply(200, 'result');

      const response = await client.request(HttpMethod.post, '/products', {});

      expect(response).toEqual('result');
    });

    test('makes a PUT request', async () => {
      const client = new Client('id', 'key');

      mock.onPut('/products/{id}').reply(200, 'result');

      const response = await client.request(HttpMethod.put, '/products/{id}', {
        id: 'foo',
      });

      expect(response).toEqual('result');
    });

    test('makes a DELETE request', async () => {
      const client = new Client('id', 'key');

      mock.onDelete('/products/{id}').reply(200, 'result');

      const response = await client.request(
        HttpMethod.delete,
        '/products/{id}',
        { id: 'foo' },
      );

      expect(response).toEqual('result');
    });

    test('makes a request with headers', async () => {
      const client = new Client('id', 'key');

      mock.onGet('/products/:count').reply((config) => {
        const headers = Object.fromEntries(
          Object.entries(config.headers || {}),
        );
        return [200, headers['X-Foo']];
      });

      const response = await client.request(
        HttpMethod.get,
        '/products/:count',
        {},
        { 'X-Foo': 'bar' },
      );

      expect(response).toEqual('bar');
    });

    test('handles an error response', async () => {
      const client = new Client('id', 'key');

      mock.onGet('/products/:count').reply(500, 'Internal Server Error');

      await expect(
        client.request(HttpMethod.get, '/products/:count', {}),
      ).rejects.toThrow(new Error('Internal Server Error'));
    });

    test('handles a timeout', async () => {
      const client = new Client('id', 'key');

      mock.onGet('/products/:count').timeout();

      await expect(
        client.request(HttpMethod.get, '/products/:count', {}),
      ).rejects.toThrow(new Error('timeout of 0ms exceeded'));
    });
  }); // describe: #request

  describe('#retry', () => {
    test('handle zero retries by default', async () => {
      const client = new Client('id', 'key');

      // Simulate timeout error
      mock.onGet('/products/:count').timeoutOnce();

      await expect(
        client.request(HttpMethod.get, '/products/:count', {}),
      ).rejects.toThrow(new Error('timeout of 0ms exceeded'));
    });

    test('handle retries option', async () => {
      const client = new Client('id', 'key', { retries: 3 });

      // Simulate server failure on first 2 attempts and success on the third
      mock
        .onGet('/products:variants/:count')
        .timeoutOnce()
        .onGet('/products:variants/:count')
        .timeoutOnce()
        .onGet('/products:variants/:count')
        .replyOnce(200, 42);

      const response = await client.request(
        HttpMethod.get,
        '/products:variants/:count',
        {},
      );
      expect(response).toEqual(42);
    });

    test('handle return error if response not received after retries', async () => {
      const client = new Client('id', 'key', { retries: 3 });

      // Simulate server failure on first 4 attempts and success on the fifth
      mock
        .onGet('/categories/:count')
        .timeoutOnce()
        .onGet('/categories/:count')
        .timeoutOnce()
        .onGet('/categories/:count')
        .timeoutOnce()
        .onGet('/categories/:count')
        .timeoutOnce()
        .onGet('/categories/:count')
        .replyOnce(200, 42);

      await expect(
        client.request(HttpMethod.get, '/categories/:count', {}),
      ).rejects.toThrow(new Error('timeout of 0ms exceeded'));
    });

    test('handle return error code without retries', async () => {
      const client = new Client('id', 'key', { retries: 3 });

      // Simulate server returns 404 error with 1st attempt
      let attemptsCouter = 0;
      mock.onGet('/:files/robots.txt').reply(() => {
        attemptsCouter++;
        return [404, 'Not found'];
      });

      await expect(
        client.request(HttpMethod.get, '/:files/robots.txt', {}),
      ).rejects.toThrow();
      expect(attemptsCouter).toBe(1);
    });
  }); // describe: #retry

  describe('#client recycling', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      jest.clearAllTimers();
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('should recycle client after reaching both request and time thresholds', async () => {
      const onClientRecycle = jest.fn();
      const client = new Client('id', 'key', {
        recycleAfterRequests: 2,
        recycleAfterMs: 1000,
        onClientRecycle,
      });

      // Mock successful responses
      mock.onGet('/test').reply(200, 'ok');

      const initialClient = client.httpClient;

      // Make first request
      await client.get('/test');
      expect(client.httpClient).toBe(initialClient);
      expect(onClientRecycle).not.toHaveBeenCalled();

      // Make second request without advancing time - should not recycle
      await client.get('/test');
      expect(client.httpClient).toBe(initialClient);
      expect(onClientRecycle).not.toHaveBeenCalled();

      // Advance time to meet recycling criteria and make another request
      jest.advanceTimersByTime(1001);
      await client.get('/test');

      // Client should be recycled
      expect(client.httpClient).not.toBe(initialClient);
      expect(onClientRecycle).toHaveBeenCalledWith(
        expect.objectContaining({
          totalRequests: 2,
          ageMs: expect.any(Number),
          newClientCreatedAt: expect.any(Number),
        }),
      );

      const finalStats = client.getClientStats();
      expect(finalStats.activeClient?.totalRequests).toBe(1);
      expect(finalStats.oldClientsCount).toBe(1);
    });

    test('should not recycle client if request threshold not met', async () => {
      const onClientRecycle = jest.fn();
      const client = new Client('id', 'key', {
        recycleAfterRequests: 5,
        recycleAfterMs: 1000,
        onClientRecycle,
      });

      mock.onGet('/test').reply(200, 'ok');

      const initialClient = client.httpClient;

      // Make requests but don't reach threshold
      await client.get('/test');
      jest.advanceTimersByTime(1001);
      await client.get('/test');

      expect(client.httpClient).toBe(initialClient);
      expect(onClientRecycle).not.toHaveBeenCalled();
    });

    test('should not recycle client if time threshold not met', async () => {
      const onClientRecycle = jest.fn();
      const client = new Client('id', 'key', {
        recycleAfterRequests: 2,
        recycleAfterMs: 1000,
        onClientRecycle,
      });

      mock.onGet('/test').reply(200, 'ok');

      const initialClient = client.httpClient;

      // Make requests but don't advance time enough
      await client.get('/test');
      await client.get('/test');
      jest.advanceTimersByTime(500);
      await client.get('/test');

      expect(client.httpClient).toBe(initialClient);
      expect(onClientRecycle).not.toHaveBeenCalled();
    });

    test('should track active and total requests correctly', async () => {
      const client = new Client('id', 'key');

      mock.onGet('/test').reply(() => {
        // Check stats during request
        const stats = client.getClientStats();
        expect(stats.activeClient?.activeRequests).toBe(1);
        return [200, 'ok'];
      });

      const initialStats = client.getClientStats();
      expect(initialStats.activeClient?.activeRequests).toBe(0);
      expect(initialStats.activeClient?.totalRequests).toBe(0);

      await client.get('/test');

      const finalStats = client.getClientStats();
      expect(finalStats.activeClient?.activeRequests).toBe(0);
      expect(finalStats.activeClient?.totalRequests).toBe(1);
    });

    test('should cleanup old clients when they have no active requests', async () => {
      const client = new Client('id', 'key', {
        recycleAfterRequests: 1,
        recycleAfterMs: 100,
      });

      mock.onGet('/test').reply(200, 'ok');

      // Trigger recycling
      await client.get('/test');
      jest.advanceTimersByTime(101);
      await client.get('/test');

      expect(client.getClientStats().oldClientsCount).toBe(1);

      // Advance time to trigger cleanup interval
      jest.advanceTimersByTime(1000);

      expect(client.getClientStats().oldClientsCount).toBe(0);
    });

    test('should handle concurrent requests correctly during recycling', async () => {
      const client = new Client('id', 'key', {
        recycleAfterRequests: 1,
        recycleAfterMs: 100,
      });

      let requestCount = 0;
      mock.onGet('/test').reply(() => {
        requestCount++;
        return [200, `response-${requestCount}`];
      });

      // Start first request
      const promise1 = client.get('/test');

      // Advance time and start second request (should trigger recycling)
      jest.advanceTimersByTime(101);
      const promise2 = client.get('/test');

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1).toBe('response-1');
      expect(result2).toBe('response-2');
      expect(client.getClientStats().oldClientsCount).toBe(1);
    });

    test('should provide accurate client stats', async () => {
      const client = new Client('id', 'key', {
        recycleAfterRequests: 2,
        recycleAfterMs: 1000,
      });

      mock.onGet('/test').reply(200, 'ok');

      const createdAt = Date.now();
      jest.setSystemTime(createdAt);

      // Initial stats
      let stats = client.getClientStats();
      expect(stats.activeClient?.createdAt).toBe(createdAt);
      expect(stats.activeClient?.activeRequests).toBe(0);
      expect(stats.activeClient?.totalRequests).toBe(0);
      expect(stats.activeClient?.ageMs).toBe(0);
      expect(stats.oldClientsCount).toBe(0);

      // After requests
      await client.get('/test');
      await client.get('/test');
      stats = client.getClientStats();
      expect(stats.activeClient?.totalRequests).toBe(2);

      // Advance time and trigger recycling
      jest.advanceTimersByTime(1001);
      await client.get('/test');

      stats = client.getClientStats();
      expect(stats.activeClient?.totalRequests).toBe(1); // New client has 1 request
      expect(stats.oldClientsCount).toBe(1);
      expect(stats.oldClients).toHaveLength(1);
      expect(stats.oldClients[0]).toMatchObject({
        id: expect.any(String),
        createdAt: createdAt,
        totalRequests: 2,
        ageMs: expect.any(Number),
      });
    });

    test('should call onClientRecycle callback with correct stats', async () => {
      const onClientRecycle = jest.fn();
      const client = new Client('id', 'key', {
        recycleAfterRequests: 1,
        recycleAfterMs: 100,
        onClientRecycle,
      });

      mock.onGet('/test').reply(200, 'ok');

      const startTime = Date.now();
      jest.setSystemTime(startTime);

      // Trigger recycling
      await client.get('/test');
      jest.advanceTimersByTime(101);
      await client.get('/test');

      expect(onClientRecycle).toHaveBeenCalledWith({
        createdAt: startTime,
        activeRequests: 0,
        totalRequests: 1,
        ageMs: 101,
        newClientCreatedAt: expect.any(Number),
      });
    });

    test('should use default recycling values when not specified', async () => {
      const onClientRecycle = jest.fn();
      const client = new Client('id', 'key', { onClientRecycle });

      mock.onGet('/test').reply(200, 'ok');

      const initialClient = client.httpClient;

      // Make many requests but don't reach default threshold (1000)
      for (let i = 0; i < 999; i++) {
        await client.get('/test');
      }

      // Advance time past default (15000ms) but still below request threshold
      jest.advanceTimersByTime(20000);
      await client.get('/test');

      // Should not recycle because request threshold not met
      expect(client.httpClient).toBe(initialClient);
      expect(onClientRecycle).not.toHaveBeenCalled();

      // Now reach the request threshold
      await client.get('/test');

      // Should recycle now
      expect(client.httpClient).not.toBe(initialClient);
      expect(onClientRecycle).toHaveBeenCalled();
    });

    test('should handle error in onClientRecycle callback gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const onClientRecycle = jest.fn().mockImplementation(() => {
        throw new Error('Callback error');
      });

      const client = new Client('id', 'key', {
        recycleAfterRequests: 1,
        recycleAfterMs: 100,
        onClientRecycle,
      });

      mock.onGet('/test').reply(200, 'ok');

      // This should not throw even though callback throws
      await client.get('/test');
      jest.advanceTimersByTime(101);
      await expect(client.get('/test')).resolves.toBe('ok');

      expect(onClientRecycle).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Error in onClientRecycle callback:',
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });
  }); // describe: #client recycling
});
