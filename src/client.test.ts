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
      });
    });

    test('overrides default options', () => {
      client.init('id', 'key', {
        verifyCert: false,
        version: 2,
      });

      expect(client.options).toEqual({
        headers: {},
        url: 'https://api.swell.store',
        verifyCert: false,
        version: 2,
        retries: 0,
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

  describe('#rotateConnections', () => {
    let client: Client;

    beforeEach(() => {
      client = new Client('id', 'key', {
        connectionPool: {
          keepAlive: true,
          maxSockets: 100,
          keepAliveMsecs: 1000,
        },
      });
    });

    test('rotates default 20% of connections', () => {
      // Create mock sockets
      const mockSockets = Array.from({ length: 10 }, (_, i) => ({
        destroyed: false,
        id: `socket${i}`,
      }));

      // Mock the agents with sockets
      (client as any).httpAgent = {
        keepAlive: true,
        keepAliveMsecs: 1000,
        sockets: {
          'api.swell.store:443': [...mockSockets.slice(0, 5)],
        },
      };

      (client as any).httpsAgent = {
        keepAlive: true,
        keepAliveMsecs: 1000,
        sockets: {
          'api.swell.store:443': [...mockSockets.slice(5, 10)],
        },
      };

      const rotated = client.rotateConnections();
      
      // Should rotate 20% of 10 sockets = 2 sockets
      expect(rotated).toBe(2);
      
      // Check that sockets were removed from pools
      const httpRemaining = (client as any).httpAgent.sockets['api.swell.store:443'].length;
      const httpsRemaining = (client as any).httpsAgent.sockets['api.swell.store:443'].length;
      expect(httpRemaining + httpsRemaining).toBe(8);
    });

    test('rotates specified percentage of connections', () => {
      const mockSockets = Array.from({ length: 10 }, (_, i) => ({
        destroyed: false,
        id: `socket${i}`,
      }));

      (client as any).httpsAgent = {
        keepAlive: true,
        keepAliveMsecs: 1000,
        sockets: {
          'api.swell.store:443': [...mockSockets],
        },
      };

      const rotated = client.rotateConnections({ percentage: 0.5 });
      
      // Should rotate 50% of 10 sockets = 5 sockets
      expect(rotated).toBe(5);
      expect((client as any).httpsAgent.sockets['api.swell.store:443'].length).toBe(5);
    });

    test('handles multiple hosts in socket pools', () => {
      (client as any).httpsAgent = {
        keepAlive: true,
        keepAliveMsecs: 1000,
        sockets: {
          'api.swell.store:443': [{ destroyed: false }, { destroyed: false }],
          'cdn.swell.store:443': [{ destroyed: false }, { destroyed: false }],
          'admin.swell.store:443': [{ destroyed: false }, { destroyed: false }],
        },
      };

      const rotated = client.rotateConnections({ percentage: 0.5 });
      
      // Should rotate 50% from each host: 1 + 1 + 1 = 3
      expect(rotated).toBe(3);
    });

    test('returns 0 when no keepAlive configured', () => {
      (client as any).httpsAgent = {
        keepAlive: false, // No keep-alive
        sockets: {
          'api.swell.store:443': [{ destroyed: false }, { destroyed: false }],
        },
      };

      const rotated = client.rotateConnections();
      expect(rotated).toBe(0);
    });

    test('returns 0 when no keepAliveMsecs configured', () => {
      (client as any).httpsAgent = {
        keepAlive: true,
        keepAliveMsecs: undefined, // No timeout
        sockets: {
          'api.swell.store:443': [{ destroyed: false }, { destroyed: false }],
        },
      };

      const rotated = client.rotateConnections();
      expect(rotated).toBe(0);
    });

    test('returns 0 when keepAliveMsecs is too high', () => {
      (client as any).httpsAgent = {
        keepAlive: true,
        keepAliveMsecs: 70000, // > 60000ms
        sockets: {
          'api.swell.store:443': [{ destroyed: false }, { destroyed: false }],
        },
      };

      const rotated = client.rotateConnections();
      expect(rotated).toBe(0);
    });

    test('handles empty socket pools', () => {
      (client as any).httpsAgent = {
        keepAlive: true,
        keepAliveMsecs: 1000,
        sockets: {
          'api.swell.store:443': [],
        },
      };

      const rotated = client.rotateConnections();
      expect(rotated).toBe(0);
    });

    test('handles missing agents gracefully', () => {
      (client as any).httpAgent = null;
      (client as any).httpsAgent = null;

      const rotated = client.rotateConnections();
      expect(rotated).toBe(0);
    });

    test('skips destroyed sockets', () => {
      (client as any).httpsAgent = {
        keepAlive: true,
        keepAliveMsecs: 1000,
        sockets: {
          'api.swell.store:443': [
            { destroyed: true },
            { destroyed: false },
            { destroyed: true },
            { destroyed: false },
          ],
        },
      };

      const rotated = client.rotateConnections({ percentage: 1.0 });
      
      // Should only count non-destroyed sockets
      expect(rotated).toBe(2);
      expect((client as any).httpsAgent.sockets['api.swell.store:443'].length).toBe(0);
    });

    test('clamps percentage to valid range', () => {
      const mockSockets = Array.from({ length: 10 }, () => ({ destroyed: false }));

      (client as any).httpsAgent = {
        keepAlive: true,
        keepAliveMsecs: 1000,
        sockets: {
          'api.swell.store:443': [...mockSockets],
        },
      };

      // Test percentage > 1
      let rotated = client.rotateConnections({ percentage: 1.5 });
      expect(rotated).toBe(10); // Should clamp to 1.0

      // Reset sockets
      (client as any).httpsAgent.sockets['api.swell.store:443'] = [...mockSockets];

      // Test negative percentage
      rotated = client.rotateConnections({ percentage: -0.5 });
      expect(rotated).toBe(0); // Should clamp to 0
    });

    test('removes sockets randomly', () => {
      // This test verifies randomness by checking distribution over multiple runs
      const runRotationTest = () => {
        const mockSockets = Array.from({ length: 10 }, (_, i) => ({
          destroyed: false,
          id: i,
        }));

        (client as any).httpsAgent = {
          keepAlive: true,
          keepAliveMsecs: 1000,
          sockets: {
            'api.swell.store:443': [...mockSockets],
          },
        };

        client.rotateConnections({ percentage: 0.3 }); // Rotate 3 out of 10
        
        // Return IDs of remaining sockets
        return (client as any).httpsAgent.sockets['api.swell.store:443'].map((s: any) => s.id);
      };

      // Run multiple times to check for randomness
      const results = new Set();
      for (let i = 0; i < 10; i++) {
        const remaining = runRotationTest();
        results.add(JSON.stringify(remaining.sort()));
      }

      // Should have different combinations (not always the same sockets removed)
      expect(results.size).toBeGreaterThan(1);
    });
  }); // describe: #rotateConnections
});
