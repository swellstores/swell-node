const Connection = require('./connection');

describe('Connection', () => {
  describe('#constructor', () => {
    it('builds params from defaults', () => {
      const conn = new Connection('host', 'port', { op: 'value' });
      expect(conn.options).toEqual({
        op: 'value',
      });
    });
  });

  describe('#receive', () => {
    it('should call receiveResponse on newline character', () => {
      const conn = new Connection('host', 'port');
      conn.receiveResponse = jest.fn();

      const response = JSON.stringify({ $push: true });
      conn.receive(null, response);
      conn.receive(null, '\n');
      expect(conn.receiveResponse).toHaveBeenCalledWith(response);
    });

    it('should call receiveResponse on newline character (multiple chunks in one buffer)', () => {
      const conn = new Connection('host', 'port');
      conn.receiveResponse = jest.fn();

      const response1 = JSON.stringify({ value: 123 });
      const response2 = JSON.stringify({ value: 456 });
      const response3 = JSON.stringify({ value: 789 });

      conn.receive(null, `${response1}\n${response2}\n${response3}\n`);

      expect(conn.receiveResponse).toHaveBeenCalledWith(response1);
      expect(conn.receiveResponse).toHaveBeenCalledWith(response2);
      expect(conn.receiveResponse).toHaveBeenCalledWith(response3);
    });
  });

  describe('#receiveResponse', () => {
    it('should call onPush when receiving $push response', () => {
      const onPush = jest.fn();
      const conn = new Connection('host', 'port', {
        onPush,
      });
      const response = { $push: true };
      conn.receiveResponse(JSON.stringify(response));
      expect(onPush).toHaveBeenCalledWith(response);
    });

    it('should not call onPush when not receiving $push response', () => {
      const onPush = jest.fn();
      const conn = new Connection('host', 'port', {
        onPush,
      });
      const response = { $data: null };
      conn.receiveResponse(JSON.stringify(response));
      expect(onPush).not.toHaveBeenCalled();
    });

    it('should not error when onPush is not defined', () => {
      const conn = new Connection('host', 'port');
      const response = { $push: true };
      conn.receiveResponse(JSON.stringify(response));
    });

    it('should buffer regular requests until the connection is ready', () => {
      const conn = new Connection('host', 'port');
      conn.connected = true;
      conn.stream = {
        write: () => {},
      };

      // initially the connection is not ready
      expect(conn.ready).toBe(false);

      const callbackSpy = jest.fn();

      // send a regular request
      conn.request('get', '/products', {}, callbackSpy);

      // make sure the request is in the pending buffer
      expect(conn.requestBuffer.length).toBe(0);
      expect(conn.pendingBuffer.length).toBe(1);

      // send `auth` and `cached` service requests
      conn.request('auth', callbackSpy);
      conn.request('cached', callbackSpy);

      // make sure that service requests have been written to the active buffer
      expect(conn.requestBuffer.length).toBe(2);
      expect(conn.pendingBuffer.length).toBe(1);

      // send a regular request including authorization information
      conn.request(
        'get',
        '/products',
        { $client: 'test', $key: 'test_key' },
        callbackSpy
      );

      // make sure that such a request will be added to the active buffer
      expect(conn.requestBuffer.length).toBe(3);
      expect(conn.pendingBuffer.length).toBe(1);

      // simulate the execution of auth and cached requests
      conn.requestBuffer.length = 0;

      // called after authorization
      conn.flushPendingBuffer();

      // now the connection is ready
      expect(conn.ready).toBe(true);
      expect(conn.requestBuffer.length).toBe(1);
      expect(conn.pendingBuffer.length).toBe(0);

      // make sure that all requests are now added to the active buffer
      conn.request('get', '/products', {}, callbackSpy);
      conn.request('cached', callbackSpy);
      conn.request('auth', callbackSpy);

      expect(conn.requestBuffer.length).toBe(4);
      expect(conn.pendingBuffer.length).toBe(0);
    });

    it('should resolve requests in any order, if $req_id is defined', () => {
      const conn = new Connection('host', 'port');
      conn.ready = true;
      conn.connected = true;
      conn.stream = {
        write: () => {},
      };

      const productCallback = jest.fn();
      const productResult = {
        $data: { id: 'prod_1', name: 'Product 1' },
        $time: 1,
        $status: 200,
        $req_id: 'r1',
      };
      const categoriesCallback = jest.fn();
      const categoriesResult = {
        $data: {
          count: 0,
          page_count: 1,
          page: 1,
          results: [],
        },
        $time: 1,
        $status: 200,
        $req_id: 'r2',
      };

      conn.request(
        'get',
        '/products/prod_1',
        {
          $data: {},
          $req_id: 'r1',
        },
        productCallback,
      );
      conn.request(
        'get',
        '/categories',
        {
          $data: {},
          $req_id: 'r2',
        },
        categoriesCallback,
      );
      conn.receiveResponse(JSON.stringify(categoriesResult));
      conn.receiveResponse(JSON.stringify(productResult));
      expect(categoriesCallback).toHaveBeenCalledWith(categoriesResult);
      expect(productCallback).toHaveBeenCalledWith(productResult);
    });
  });
});
