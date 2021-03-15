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

  describe('#receiveResponse', () => {
    it('should call onPush when receiving $push response', () => {
      const onPush = jest.fn()
      const conn = new Connection('host', 'port', {
        onPush,
      });
      const response = { $push: true };
      conn.receiveResponse(JSON.stringify(response));
      expect(onPush).toHaveBeenCalledWith(response);
    });

    it('should not call onPush when not receiving $push response', () => {
      const onPush = jest.fn()
      const conn = new Connection('host', 'port', {
        onPush,
      });
      const response = { $data: null };
      conn.receiveResponse(JSON.stringify(response));
      expect(onPush).not.toHaveBeenCalled();
    });

    it('should not error when onPush is not defined', () => {
      const onPush = jest.fn()
      const conn = new Connection('host', 'port');
      const response = { $push: true };
      conn.receiveResponse(JSON.stringify(response));
    });
  });
});
