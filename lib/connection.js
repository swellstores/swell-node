'use strict';

const EventEmitter = require('events');
const tls = require('tls');
const net = require('net');

const DEFAULT_TIMEOUT = 30000;
const RETRY_TIME = 3000;
const MAX_CONCURRENT = 10;

class Connection extends EventEmitter {
  /**
   * @param {string} host
   * @param {number | string} port
   * @param {object} [options]
   * @param {(connection: Connection) => void} [callback]
   */
  constructor(host, port, options, callback) {
    super();

    /** @type {tls.TLSSocket | null} */
    this.stream = null;
    this.connected = false;
    this.connectingTimeout = null;
    this.connectingRetryTimeout = null;
    /** @type {string[]} */
    this.buffer = [];
    this.requestBuffer = [];
    this.requested = 0;
    /** @type {Map<string, (response: any) => void>} to register callbacks if responses can be received in any order */
    this.requestCallbacks = new Map();

    this.host = host;
    this.port = port;

    options = options || {};
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    this.options = options;

    this.maxConcurrent = Number(options.maxConcurrent) || MAX_CONCURRENT;

    if (callback) {
      this.connect(callback);
    }
  }

  /**
   * @param {(connection: Connection) => void} callback
   * @returns {void}
   */
  connect(callback) {
    const proto = this.options.clear ? net : tls;
    const timeoutMs = this.options.timeout || DEFAULT_TIMEOUT;

    this.stream = proto.connect(
      {
        host: this.host,
        port: this.port,
        rejectUnauthorized: this.options.verifyCert === false ? false : true,
      },
      () => {
        this.connected = true;
        clearTimeout(this.connectingTimeout);
        this.connectingTimeout = null;
        this.flushRequestBuffer();
        callback && callback(this);
        this.emit('connect');
      },
    );
    this.stream.on('error', this.error.bind(this, this.stream));
    this.stream.on('data', this.receive.bind(this, this.stream));
    this.stream.on('close', this.close.bind(this, this.stream));
    this.stream.on('timeout', this.timeout.bind(this, this.stream));
    this.stream.setEncoding('utf8');

    // Retry periodically just in case
    this.connectingRetryTimeout = setTimeout(() => {
      const shouldReconnect = !this.connected && this.requestBuffer.length > 0;
      if (shouldReconnect) {
        this.connectingRetryTimeout = null;
        this.connect();
      }
    }, RETRY_TIME * 2);

    // Final timeout
    if (!this.connectingTimeout) {
      this.connectingTimeout = setTimeout(() => {
        if (!this.connected) {
          this.connectingTimeout = null;
          this.flushRequestBufferWithError(
            `Connection timed out (${timeoutMs} ms)`,
          );
          // Retry connection
          this.connect();
        }
      }, timeoutMs);
    }
  }

  /**
   * @param {string} method
   * @param {string} url
   * @param {object} data
   * @param {(response: any) => void} callback
   * @returns {void}
   */
  request(...args) {
    this.requestBuffer.push(args);

    if (!this.connected || !this.stream) {
      if (!this.stream) {
        this.connect();
      }
      return;
    }

    this.requestNext();
  }

  requestNext() {
    if (this.requested > this.maxConcurrent) {
      return;
    }

    const args = this.requestBuffer[this.requested];

    if (args) {
      // last argument is the callback
      const requestArr = args.slice(0, -1);
      const req_id = requestArr[requestArr.length - 1]?.$req_id;
      // Register callback in map, if $req_id is specified
      if (req_id) {
        const callback = args[args.length - 1];
        this.requestCallbacks.set(req_id, callback);
      }

      const request = JSON.stringify(requestArr);
      this.stream.write(request + '\n');
      this.requested += 1;
    }
  }

  /**
   * @param {tls.TLSSocket} stream 
   * @param {string} buffer 
   * @returns {void}
   */
  receive(stream, buffer) {
    if (stream && this.stream !== stream) return;

    // Split buffer data on newline char
    const chunks = buffer.split('\n');

    // The last chunk of data may be incomplete
    // The length of the last chunk will be 0 if the last character in the buffer is a newline
    const lastChunk = chunks.pop();

    for (const chunk of chunks) {
      let data = chunk;

      if (this.buffer.length > 0) {
        this.buffer.push(chunk);
        data = this.buffer.join('');
        this.buffer.length = 0;
      }

      this.receiveResponse(data);
    }

    if (lastChunk.length > 0) {
      this.buffer.push(lastChunk);
    }
  }

  /**
   * @param {string} data
   * @returns {void}
   */
  receiveResponse(data) {
    let response;

    try {
      response = JSON.parse(data);
    } catch (err) {
      //
    }

    if (response && response.$push) {
      if (this.options.onPush) {
        this.options.onPush(response);
      }
      return;
    }

    const request = this.requestBuffer.shift();

    let responder;
    const req_id = response?.$req_id;
    if (req_id) {
      // If $req_id is specified using callback from requestCallbacks map
      responder = this.requestCallbacks.get(req_id);
      this.requestCallbacks.delete(req_id);
    } else {
      // Otherwise use callback from last argument of request
      responder = request && request.pop();
    }

    this.requested -= 1;

    if (responder === undefined) {
      return;
    }

    if (!response || typeof response !== 'object') {
      response = 'Invalid response from server (' + data + ')';
      this.emit('error.protocol', response);
      return responder({
        $status: 500,
        $error: response,
      });
    }

    if (response.$error) {
      this.emit('error.server', response.$error);
    }
    if (response.$end) {
      this.close(this.stream);
    }

    // Note: response always returns in the same order as request
    if (typeof responder === 'function') {
      responder(response);
    }

    if (this.connected && this.stream) {
      this.requestNext();
    }
  }

  /**
   * @param {tls.TLSSocket} stream
   * @param {Error} error
   */
  error(stream, error) {
    const shouldReconnect =
      !this.connected &&
      this.requestBuffer.length > 0 &&
      !this.connectingRetryTimeout;

    if (shouldReconnect) {
      this.connectingRetryTimeout = setTimeout(() => {
        this.connectingRetryTimeout = null;
        if (!this.connected) {
          this.connect();
        }
      }, RETRY_TIME);
    }

    this.emit('error', error);
  }

  /**
   * @param {tls.TLSSocket} stream
   * @returns {void}
   */
  close(stream) {
    if (stream && this.stream !== stream) return;

    this.emit('close');

    if (!this.connected) {
      return;
    }

    if (this.stream && this.stream.writable) {
      this.stream.end();
    }

    this.connected = false;
    this.stream = null;
    this.requestCallbacks.clear();

    if (this.requestBuffer.length > 0) {
      this.connect();
    }
  }

  /**
   * Handle timeout by closing if no requests are pending
   *
   * @param {tls.TLSSocket} stream 
   * @param {Error} error 
   * @returns 
   */
  timeout(stream, error) {
    if (stream && this.stream !== stream) return;

    if (this.requestBuffer.length > 0) {
      return;
    }

    this.close(stream);
  }

  /**
   * FLush all requests when connected
   */
  flushRequestBuffer() {
    if (!this.connected) {
      return;
    }

    const requestBuffer = this.requestBuffer;
    this.requestBuffer = [];
    this.requested = 0;

    for (const request of requestBuffer) {
      this.request(...request);
    }
  }

  /**
   * Flush all requests when a connection error occurs
   *
   * @param {string} error 
   * @returns {void}
   */
  flushRequestBufferWithError(error) {
    const requestBuffer = this.requestBuffer;
    this.requestBuffer = [];

    for (const request of requestBuffer) {
      const responder = request && request.pop();

      if (typeof responder === 'function') {
        responder({
          $status: 500,
          $error: error,
        });
      }
    }
  }
}

module.exports = Connection;
