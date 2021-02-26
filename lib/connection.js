const inherits = require('util').inherits;
const events = require('events');
const tls = require('tls');
const net = require('net');

const DEFAULT_NETWORK_ERROR = 'Server unexpectedly closed network connection.';
const DEFAULT_TIMEOUT = 30000;
const RETRY_TIME = 3000;
const MAX_CONCURRENT = 10;

const Connection = function(host, port, options, callback) {
  events.EventEmitter.call(this);

  this.stream = null;
  this.connected = false;
  this.connectingTimeout = null;
  this.connectingRetryTimeout = null;
  this.buffer = [];
  this.requestBuffer = [];
  this.requested = 0;

  this.host = host;
  this.port = port;

  options = options || {};
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  this.options = options;

  if (callback) {
    this.connect(callback);
  }
};

inherits(Connection, events.EventEmitter);

Connection.prototype.connect = function(callback) {
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

  if (!this.connectingTimeout) {
    this.connectingTimeout = setTimeout(() => {
      if (!this.connected) {
        this.connectingTimeout = null;
        this.flushRequestBufferWithError(`Connection timed out (${timeoutMs} ms)`);
        // Retry connection
        this.connect();
      }
    }, timeoutMs);
  }
};

Connection.prototype.request = function() {
  // Copy args to avoid leaking
  const args = new Array(arguments.length);
  for (let i = 0; i < arguments.length; i++) {
    args[i] = arguments[i];
  }

  this.requestBuffer.push(args);

  if (!this.connected || !this.stream) {
    if (!this.stream) {
      this.connect();
    }
    return;
  }

  this.requestNext();
};

Connection.prototype.requestNext = function() {
  if (this.requested > MAX_CONCURRENT) {
    return;
  }
  const args = this.requestBuffer[this.requested];
  if (args) {
    const request = JSON.stringify(args.slice(0, -1));
    this.stream.write(request + '\n');
    this.requested++;
  }
};

Connection.prototype.receive = function(stream, buffer) {
  if (stream && this.stream !== stream) return;

  // Split buffer data on newline char
  for (var i = 0, j = 0; i < buffer.length; i++) {
    if (buffer[i] === '\n') {
      this.buffer.push(buffer.slice(j, i));

      const data = this.buffer.join('');

      this.buffer = [];
      this.receiveResponse(data);

      j = i + 1;
    }
  }
  if (j < buffer.length) {
    this.buffer.push(buffer.slice(j, buffer.length));
  }
};

Connection.prototype.receiveResponse = function(data) {
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
  const responder = request && request.pop();

  this.requested--;

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
};

Connection.prototype.error = function(stream, error) {
  //if (stream && this.stream !== stream) return;

  const shouldReconnect =
    !this.connected && this.requestBuffer.length > 0 && !this.connectingRetryTimeout;
  if (shouldReconnect) {
    this.connectingRetryTimeout = setTimeout(() => {
      this.connectingRetryTimeout = null;
      if (!this.connected) {
        this.connect();
      }
    }, RETRY_TIME);
  }
  this.emit('error', error);
};

Connection.prototype.close = function(stream) {
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

  if (this.requestBuffer.length > 0) {
    this.connect();
  }
};

// Handle timeout by closing if no requests are pending
Connection.prototype.timeout = function(stream, error) {
  if (stream && this.stream !== stream) return;

  if (this.requestBuffer.length) {
    return;
  }

  this.close(stream);
};

// FLush all requests when connected
Connection.prototype.flushRequestBuffer = function() {
  if (!this.connected) {
    return;
  }
  const requestBuffer = this.requestBuffer;
  this.requestBuffer = [];
  this.requested = 0;
  while (requestBuffer.length) {
    this.request.apply(this, requestBuffer.shift());
  }
};

// Flush all requests when a connection error occurs
Connection.prototype.flushRequestBufferWithError = function(error) {
  let hasRequests = this.requestBuffer.length;
  while (--hasRequests >= 0) {
    const request = this.requestBuffer.shift();
    const responder = request && request.pop();
    if (typeof responder === 'function') {
      responder({
        $status: 500,
        $error: error,
      });
    }
  }
};

exports.Connection = Connection;
