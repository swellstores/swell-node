'use strict';

const EventEmitter = require('events');
const tls = require('tls');
const net = require('net');

const DEFAULT_TIMEOUT = 30000;
const RETRY_TIME = 3000;
const MAX_CONCURRENT = 10;

/**
 * @template T
 * @param {Array<T>} array
 * @returns {T | undefined}
 */
function getLastElement(array) {
  return Array.isArray(array)
    ? array[array.length - 1]
    : undefined;
}

/**
 * @param {any[]} request
 * @returns {boolean}
 */
function hasRequestAuthData(request) {
  const data = request[request.length - 2];
  return data.$client && data.$key;
}

/**
 * Connection workflow
 *
 * When a Connection is created, an attempt will be made to connect to the server immediately.
 * If a callback was passed.
 *
 * If the connection attempt fails, several retries will occur, after which an error will be thrown.
 * All requests will be rejected with this error.
 *
 * While the connection has not yet been established, the client can still send requests.
 * Such requests are added to the pending buffer.
 * This applies to all requests except service requests, such as `auth` and `cached`.
 * These requests are always added to the active buffer and will be executed immediately after the connection is established.
 *
 * The first request to the server should be authorization, where credentials are transmitted in the body of the request.
 * Until authorization is completed, no other requests will be sent. All requests will be added to the pending buffer.
 *
 * Once authorization is complete, all requests in the pending buffer will be moved to the active buffer.
 * __From this moment on, the connection is considered ready.__
 * Requests will be sent to the server according to the concurrency settings.
 *
 * When the connection unexpectedly breaks down and there are pending requests in the active buffer,
 * all those requests will be moved to the pending buffer.
 * After the connection is broken, we need to re-establish the connection and go through authorization again.
 * No other requests should be submitted until re-authorization is completed.
 * All requests that were not completed will be sent again as soon as the connection is ready again.
 */
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
    /**
     * if the connection is not ready
     * then it can only perform service requests such as `auth` or `cached`
     */
    this.ready = false;
    this.connected = false;
    this.connectingTimeout = null;
    this.connectingRetryTimeout = null;
    /** @type {string[]} */
    this.buffer = [];
    // TODO: replace the array with a queue data structure
    this.requestBuffer = [];
    /** Pending requests will be sent for execution after authorization */
    this.pendingBuffer = [];
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

    if (typeof callback === 'function') {
      this.connect(callback);
    }
  }

  /**
   * @param {(connection: Connection) => void} [callback]
   * @returns {void}
   */
  connect(callback) {
    const proto = this.options.clear ? net : tls;
    const timeoutMs = this.options.timeout || DEFAULT_TIMEOUT;

    this.ready = false;

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

        if (typeof callback === 'function') {
          callback(this);
        }

        this.emit('connect');

        if (this.isBufferNotEmpty()) {
          // Ask the client to create an authorization request
          this.emit('auth.require');
        }
      },
    );

    this.stream
      .setEncoding('utf8')
      .on('error', this.error.bind(this, this.stream))
      .on('data', this.receive.bind(this, this.stream))
      .on('close', this.close.bind(this, this.stream))
      .on('timeout', this.timeout.bind(this, this.stream));

    // Retry periodically just in case
    this.connectingRetryTimeout = setTimeout(() => {
      const shouldReconnect = !this.connected && this.isBufferNotEmpty();

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
    switch (args[0]) {
      case 'auth':
      case 'cached':
        // Service requests are always added to the execution queue
        this.requestBuffer.push(args);
        break;

      default: {
        // Until the connection is ready
        // all regular requests are added to the waiting queue
        // until authorization is completed
        const list = this.ready || hasRequestAuthData(args)
          ? this.requestBuffer
          : this.pendingBuffer;

        list.push(args);
        break;
      }
    }

    if (!this.connected) {
      return;
    }

    if (!this.stream) {
      this.connect();
      return;
    }

    this.requestNext();
  }

  requestNext() {
    if (this.requested > this.maxConcurrent) {
      return;
    }

    // Check array length to avoid creating holes
    const args = this.requestBuffer.length > this.requested
      ? this.requestBuffer[this.requested]
      : undefined;

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
      responder = getLastElement(request);
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
      this.isBufferNotEmpty() &&
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

    this.ready = false;
    this.connected = false;
    this.stream = null;
    this.requestCallbacks.clear();

    this.pendingBuffer.unshift(
      ...this.requestBuffer.filter((request) =>
        Array.isArray(request) &&
          request[0] !== 'auth' &&
          request[0] !== 'cached'
      ),
    );

    this.requestBuffer = [];
    this.requested = 0;

    if (this.isBufferNotEmpty()) {
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

    if (this.isBufferNotEmpty()) {
      return;
    }

    this.close(stream);
  }

  /**
   * Flush all requests upon connection
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
   * Flush pending requests upon connection and authorization
   */
  flushPendingBuffer() {
    if (!this.connected) {
      return;
    }

    const requestBuffer = this.pendingBuffer;
    this.pendingBuffer = [];
    this.ready = true;

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
    const requestBuffer = this.requestBuffer.concat(this.pendingBuffer);
    this.requestBuffer = [];
    this.pendingBuffer = [];
    this.requested = 0;

    for (const request of requestBuffer) {
      const responder = getLastElement(request);

      if (typeof responder === 'function') {
        responder({
          $status: 500,
          $error: error,
        });
      }
    }
  }

  isBufferNotEmpty() {
    return this.requestBuffer.length > 0 || this.pendingBuffer.length > 0;
  }
}

module.exports = Connection;
