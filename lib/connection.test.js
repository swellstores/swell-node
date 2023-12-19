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
      const onPush = jest.fn();
      const conn = new Connection('host', 'port');
      const response = { $push: true };
      conn.receiveResponse(JSON.stringify(response));
    });

    it('should resolve requests in any ordrer, if $req_id is defined', () => {
      const conn = new Connection('host', 'port');
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
