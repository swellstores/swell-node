const EventEmitter = require('events');
const crypto = require('crypto');

const Connection = require('./connection');
const Cache = require('./cache');

const DEFAULT_HOST = 'api.swell.store';
const DEFAULT_PORT = 8443;
const DEFAULT_VERIFY_CERT = true;
const DEFAULT_VERSION = 1;

class Client extends EventEmitter {
  constructor(clientId, clientKey, options, callback) {
    super();

    this.params = {};
    this.server = null;
    this.cache = null;
    this.authed = false;

    if (clientId) {
      this.init(clientId, clientKey, options);
    }
    if (callback) {
      this.connect(callback);
    }
  }

  init(clientId, clientKey, options) {
    options = options || {};

    if (typeof clientKey === 'object') {
      options = clientKey;
      clientKey = undefined;
    } else if (typeof clientId === 'object') {
      options = clientId;
      clientId = undefined;
    }

    this.params = {
      clientId: clientId || options.id,
      clientKey: clientKey || options.key,
      host: options.host || DEFAULT_HOST,
      port: options.port || DEFAULT_PORT,
      verifyCert: options.verifyCert !== undefined ? options.verifyCert : DEFAULT_VERIFY_CERT,
      version: options.version || DEFAULT_VERSION,
      session: options.session,
      route: options.route,
      timeout: options.timeout,
      routeClientId: options.route && options.route.client,
      cache: options.cache !== undefined ? options.cache : true,
      debug: !!options.debug,
    };

    if (!this.params.clientId) {
      throw new Error('Swell store `id` is required to connect');
    }
    if (!this.params.clientKey) {
      throw new Error('Swell store `key` is required to connect');
    }

    this.params.endClientId = this.params.routeClientId || this.params.clientId;

    return this;
  }

  connect(callback) {
    this.server = new Connection(
      this.params.host,
      this.params.port,
      {
        verifyCert: this.params.verifyCert,
        timeout: this.params.timeout,
        onPush: this.onPush.bind(this),
      },
      () => {
        callback && callback(this);
        this.emit('connect', this);
      },
    );
    this.server.on('close', () => {
      this.authed = false;
      if (this.cache) {
        this.cache.reset();
      }
      this.emit('close');
    });
    this.server.on('error', (err) => {
      if (EventEmitter.listenerCount(this, 'error')) {
        this.emit('error', 'Error: ' + err);
      }
    });
    this.server.on('error.network', (err) => {
      if (EventEmitter.listenerCount(this, 'error')) {
        this.emit('error', 'Network error: ' + err, 'network');
      }
    });
    this.server.on('error.protocol', (err) => {
      if (EventEmitter.listenerCount(this, 'error')) {
        this.emit('error', 'Protocol error: ' + err, 'protocol');
      }
    });
    this.server.on('error.server', (err) => {
      if (EventEmitter.listenerCount(this, 'error')) {
        this.emit('error', 'Server error: ' + err, 'server');
      }
    });
  }

  request(method, url, data, callback) {
    if (typeof data === 'function') {
      callback = data;
      data = null;
    }

    if (!this.cache && this.params.cache) {
      this.cache = new Cache(this.params.endClientId, this.params.cache);
    }

    if (!this.server) {
      this.connect();
    }

    // Resolve data as promised
    const promises = this.promisifyData(data);
    if (promises.length) {
      return Promise.all(promises).then(() => {
        this.request(method, url, data, callback);
      });
    }

    // Prepare url and data for request
    url = url && url.toString ? url.toString() : '';
    data = {
      $data: data !== undefined ? data : null,
    };

    if (this.authed !== true) {
      data.$client = this.params.clientId;
      data.$key = this.params.clientKey;
      if (this.params.route) {
        data.$route = this.params.route;
      }
      if (this.cache) {
        data.$cached = this.cache.getVersions();
        data.$push = true;
      }
      if (this.params.session) {
        data.$session = this.params.session;
      }
    }

    // Capture stacktrace
    const error = new Error();

    return new Promise((resolve, reject) => {
      const responder = (err, data, response) => {
        if (callback) {
          callback(err, data, response);
        }

        if (err) {
          error.message = err;
          error.status = response.$status;

          reject(error);
        } else {
          resolve(data, response);
        }
      };

      this.server.request(method, url, data, (response) => {
        if (response.$auth) {
          if (response.$end) {
            // Connection ended, retry auth
            return this.request(method, url, data.$data, callback);
          } else {
            return this.auth(response.$auth, (response) => {
              this.authed = true;
              this.flushRequestsPendingAuth();
              return this.respond(method, url, data, response, responder);
            });
          }
        } else {
          return this.respond(method, url, data, response, responder);
        }
      });
    });
  }

  promisifyData(data) {
    if (!data) {
      return [];
    }

    function thenResolvePromisedValue(data, key) {
      data[key].then(function (val) {
        data[key] = val;
      });
    }

    const promises = [];
    if (typeof data === 'object') {
      const keys = Object.keys(data);
      for (const key of keys) {
        if (data[key] && data[key].then) {
          promises.push(data[key]);
          thenResolvePromisedValue(data, key);
        }
      }
    } else if (data instanceof Array) {
      for (let i = 0; i < data.length; i++) {
        if (data[i] && data[i].then) {
          promises.push(data[i]);
          thenResolvePromisedValue(data, i);
        }
      }
    }

    return promises;
  }

  respond(method, url, request, response, callback) {
    let err = undefined;
    let responseData = undefined;

    if (response) {
      if (response.$error) {
        err = response.$error;
      } else {
        if (this.cache) {
          this.cache.clear(response);
          if (method.toLowerCase() === 'get') {
            this.cache.put(url, request.$data, response);
          }
        }
        responseData = response.$data;
      }
    } else {
      response = { $error: 'Empty response from server', $status: 500 };
      err = response.$error;
    }
    return callback.call(this, err, responseData, response);
  }

  get(url, data, callback) {
    if (typeof data === 'function') {
      callback = data;
      data = null;
    }

    if (!this.cache && this.params.cache) {
      this.cache = new Cache(this.params.endClientId, this.params.cache);
    }

    if (this.cache) {
      const cacheResult = this.cache.get(url, data);
      if (cacheResult && cacheResult.$data !== undefined) {
        return new Promise((resolve) => {
          if (!this.authed) {
            // If not connected, do auth to get updated versions first
            this.getPendingAuth(url, data, callback, resolve);
          } else {
            if (callback) {
              callback(null, cacheResult.$data, cacheResult);
            }
            resolve(cacheResult.$data);
          }
        });
      }
    }

    return this.request('get', url, data, callback);
  }

  getPendingAuth(url, data, callback, resolve) {
    if (this.requestsPendingAuth) {
      this.requestsPendingAuth.push({ url, data, callback, resolve });
      return;
    }

    this.requestsPendingAuth = [];

    this.auth((response) => {
      if (response && response.$cached) {
        this.cache.clear(response);
      }

      this.authed = true;
      this.get(url, data, (err, result, headers) => {
        if (callback) {
          callback(null, result, headers);
        }
        resolve(result);
      });

      this.flushRequestsPendingAuth();
    });
  }

  flushRequestsPendingAuth() {
    if (!this.requestsPendingAuth) {
      return;
    }

    const requests = this.requestsPendingAuth;
    this.requestsPendingAuth = null;

    for (const req of requests) {
      this.get(req.url, req.data, (err, result, headers) => {
        if (req.callback) {
          req.callback(err, result, headers);
        }
        req.resolve(result);
      });
    }
  }

  onPush(response) {
    if (response.$cached && this.cache) {
      if (this.params.debug) {
        console.log(`[swell-node] ${this.params.endClientId} onPush`, response.$cached);
      }
      this.cache.clear(response);
    }
  }

  put(url, data, callback) {
    return this.request('put', url, data, callback);
  }

  post(url, data, callback) {
    return this.request('post', url, data, callback);
  }

  delete(url, data, callback) {
    return this.request('delete', url, data, callback);
  }

  auth(nonce, callback) {
    const clientId = this.params.clientId;
    const clientKey = this.params.clientKey;

    if (typeof nonce === 'function') {
      callback = nonce;
      nonce = null;
    }

    if (!this.server) {
      this.connect();
    }

    // 1) Get nonce
    if (!nonce) {
      return this.server.request('auth', (response) => {
        if (response && response.$data) {
          this.auth(response.$data, callback);
        } else {
          callback(response);
        }
      });
    }

    // 2) Create key hash
    const keyHash = crypto
      .createHash('md5')
      .update(clientId + '::' + clientKey)
      .digest('hex');

    // 3) Create auth key
    const authKey = crypto
      .createHash('md5')
      .update(nonce + clientId + keyHash)
      .digest('hex');

    // 4) Authenticate with client creds and options
    const creds = {
      client: clientId,
      key: authKey,
    };
    if (this.params.version) {
      creds.$v = this.params.version;
    }
    if (this.params.session) {
      creds.$session = this.params.session;
    }
    if (this.params.route) {
      creds.$route = this.params.route;
    }
    if (this.cache) {
      creds.$cached = this.cache.getVersions();
      creds.$push = true;
    }

    return this.server.request('auth', creds, callback);
  }

  close() {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.authed = false;
    }
  }

  static create(clientId, clientKey, options, callback) {
    return new Client(clientId, clientKey, options, callback);
  }
}

module.exports = Client;
