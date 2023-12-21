'use strict';

const EventEmitter = require('events');
const crypto = require('crypto');

const Connection = require('./connection');
const Cache = require('./cache');

const DEFAULT_HOST = 'api.swell.store';
const DEFAULT_PORT = 8443;
const DEFAULT_VERIFY_CERT = true;
const DEFAULT_VERSION = 1;

const MODULE_VERSION = (({ name, version }) => {
  return `${name}@${version}`;
})(require('../package.json'));

const USER_APP_VERSION =
  process.env.npm_package_name && process.env.npm_package_version
    ? `${process.env.npm_package_name}@${process.env.npm_package_version}`
    : undefined;

/**
 * @template T
 * @param {any} obj
 * @returns {asserts obj is Promise<T>}
 */
function isPromise(obj) {
  return Boolean(obj && typeof obj.then === 'function');
}

function generateRequestId() {
  return crypto.randomUUID();
}

class Client extends EventEmitter {
  constructor(clientId, clientKey, options, callback) {
    super();

    this.params = {};
    /** @type {Connection | null} */
    this.connection = null;
    /** @type {Cache | null} */
    this.cache = null;
    this.authed = false;
    /**
     * Indicates whether an authorization request has been submitted
     * but not yet completed
     */
    this.authRequested = false;
    this.sentVersions = false;
    /** @type {Array | null} */
    this.requestsPendingAuth = null;
    this.env = null;

    if (clientId) {
      this.init(clientId, clientKey, options);
    }

    if (typeof callback === 'function') {
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
      verifyCert:
        options.verifyCert !== undefined
          ? options.verifyCert
          : DEFAULT_VERIFY_CERT,
      version: options.version || DEFAULT_VERSION,
      session: options.session,
      timeout: options.timeout,
      route: options.route,
      routeClientId: options.route && options.route.client,
      cache: options.cache !== undefined ? options.cache : {},
      debug: Boolean(options.debug),
      maxConcurrent: options.maxConcurrent,
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

  /**
   * @param {(client: Client) => void} [callback]
   * @returns {void}
   */
  connect(callback) {
    this.authRequested = false;

    this.connection = new Connection(
      this.params.host,
      this.params.port,
      {
        verifyCert: this.params.verifyCert,
        timeout: this.params.timeout,
        maxConcurrent: this.params.maxConcurrent,
        onPush: this.onPush.bind(this),
      },
      () => {
        if (typeof callback === 'function') {
          callback(this);
        }

        this.emit('connect', this);
      },
    );

    this.connection
      .on('auth.require', () => {
        if (this.authed) {
          // When client is already authorized then release pending requests
          this.connection.flushPendingBuffer();
        } else if (this.authRequested) {
          // When client has already requested authorization
          // then send a request with authorization
          this.connection.flushRequestBuffer();
        } else {
          // In other cases, create a request with authorization
          this.authWithKey(() => {});
        }
      })
      .on('close', () => {
        this.authed = false;
        this.sentVersions = false;
        if (this.cache) {
          this.cache.reset();
        }
        this.emit('close');
      })
      .on('error', (err) => {
        if (this.listenerCount('error') > 0) {
          this.emit('error', 'Error: ' + err);
        }
      })
      .on('error.network', (err) => {
        if (this.listenerCount('error') > 0) {
          this.emit('error', 'Network error: ' + err, 'network');
        }
      })
      .on('error.protocol', (err) => {
        if (this.listenerCount('error') > 0) {
          this.emit('error', 'Protocol error: ' + err, 'protocol');
        }
      })
      .on('error.server', (err) => {
        if (this.listenerCount('error') > 0) {
          this.emit('error', 'Server error: ' + err, 'server');
        }
      });
  }

  request(method, url, data, callback) {
    if (typeof data === 'function') {
      // Intended: request(method, url, null, callback)
      return this.request(method, url, null, data);
    }

    if (!this.cache && this.params.cache) {
      this.cache = new Cache(this.params.endClientId, this.params.cache);
    }

    if (!this.connection) {
      this.connect();
    }

    // Resolve data as promised
    const promises = this.promisifyData(data);
    if (promises.length > 0) {
      return Promise.all(promises).then(() => {
        this.request(method, url, data, callback);
      });
    }

    // Prepare url and data for request
    url = url && url.toString ? url.toString() : '';

    const params = {
      // Adding a unique request id to the request
      $req_id: generateRequestId(),
      $user_agent: MODULE_VERSION,
      $user_application: USER_APP_VERSION,
      $data: data !== undefined ? data : null,
    };

    if (!this.authed) {
      // Authenticates with key on first request
      // Get requests should use the get() method to initiate cache up front
      params.$client = this.params.clientId;
      params.$key = this.params.clientKey;

      if (this.params.route) {
        params.$route = this.params.route;
      }
      if (this.params.session) {
        params.$session = this.params.session;
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

      this.connection.request(method, url, params, (response) => {
        if (response.$auth) {
          if (response.$end) {
            // Connection ended, retry auth
            return this.request(method, url, params.$data, callback);
          }

          return this.auth(response.$auth, (response) => {
            this.flushRequestsPendingAuth();
            return this.respond(method, url, params, response, responder);
          });
        }

        if (!this.authed) {
          // Auth is handled by the first request in this case
          this.setAuthedEnv(response);
          this.sendCachedVersions(() => {});
        }

        return this.respond(method, url, params, response, responder);
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
    if (Array.isArray(data)) {
      for (let i = 0; i < data.length; ++i) {
        const value = data[i];

        if (isPromise(value)) {
          promises.push(value);
          thenResolvePromisedValue(data, i);
        }
      }
    } else if (typeof data === 'object') {
      for (const [key, value] of Object.entries(data)) {
        if (isPromise(value)) {
          promises.push(value);
          thenResolvePromisedValue(data, key);
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

  /**
   * Send a GET request
   *
   * @param {string} url The URL
   * @param {Object?} data The request data
   * @param {(err: any, data: any, response: any) => void} callback The callback function
   */
  get(url, data, callback) {
    if (!url) {
      return Promise.reject(new Error('url is required'));
    }

    if (typeof data === 'function') {
      // Intended: get(url, null, callback)
      return this.get(url, null, data);
    }

    // Initialize local cache
    if (!this.cache && this.params.cache) {
      this.cache = new Cache(this.params.endClientId, this.params.cache);
    }

    if (!this.authed) {
      // If not connected, do auth to get updated versions first
      return this.getPendingAuth(url, data, callback);
    }

    // Indicates whether to check the request cache or not
    const isRequestCacheable = data?.$nocache === undefined;

    if (this.cache && this.sentVersions && isRequestCacheable) {
      const cacheResult = this.cache.get(url, data);
      if (cacheResult?.$data !== undefined) {
        return new Promise((resolve) => {
          if (typeof callback === 'function') {
            callback(null, cacheResult.$data, cacheResult);
          }
          resolve(cacheResult.$data);
        });
      }
    }

    return this.request('get', url, data, callback);
  }

  getPendingAuth(url, data, callback) {
    return new Promise((resolve, reject) => {
      if (this.requestsPendingAuth) {
        this.requestsPendingAuth.push({ url, data, callback, resolve });
        return;
      }

      this.requestsPendingAuth = [];

      this.authWithKey(() => {
        this.get(url, data, (err, result, headers) => {
          if (typeof callback === 'function') {
            callback(err, result, headers);
          }

          if (err) {
            reject(err);
            return;
          }

          resolve(result);
        })
        .catch((err) => {
          reject(err.message);
        });
      });
    }).then((result) => {
      this.flushRequestsPendingAuth();
      return result;
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

  /**
   * Handles push messages from the server.
   */
  onPush(response) {
    if (!this.cache) {
      return;
    }

    if (!response) {
      return;
    }

    if (response.$cached) {
      // Invalidate a single entry in the cache.
      if (this.params.debug) {
        console.log(
          `[swell-node] ${this.params.endClientId} onPush`,
          response.$cached,
        );
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

  /**
   * Auth using `nonce` is mostly deprecated
   *
   * @deprecated prefer to use `authWithKey` instead
   */
  auth(nonce, callback) {
    const clientId = this.params.clientId;
    const clientKey = this.params.clientKey;

    if (typeof nonce === 'function') {
      callback = nonce;
      nonce = null;
    }

    if (!this.connection) {
      this.connect();
    }

    // 1) Get nonce
    if (!nonce) {
      return this.connection.request('auth', (response) => {
        if (response?.$data) {
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
      creds.$cached = {};
      creds.$push = true;
    }

    this.authRequested = true;

    return this.connection.request('auth', creds, (response) => {
      this.setAuthedEnv(response);
      this.sendCachedVersions(() => {
        callback(response);
      });
    });
  }

  authWithKey(callback) {
    if (!this.connection) {
      this.connect();
    }

    // Authenticate with client key initially
    // This is used to get $env before sending cached versions
    const creds = {
      $req_id: generateRequestId(),
      $user_agent: MODULE_VERSION,
      $user_application: USER_APP_VERSION,
      client: this.params.clientId,
      key: this.params.clientKey,
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
      creds.$cached = {};
      creds.$push = true;
    }

    this.authRequested = true;

    return this.connection.request('auth', creds, (response) => {
      this.setAuthedEnv(response);
      this.sendCachedVersions(() => {
        callback(response);
      });
    });
  }

  /**
   * @param {() => void} callback
   * @returns {void}
   */
  sendCachedVersions(callback) {
    if (!this.cache || !this.connection) {
      return callback();
    }

    if (!this.sentVersions) {
      const $cached = this.cache.getVersions();

      if ($cached && Object.keys($cached).length > 0) {
        return this.connection.request(
          'cached',
          {
            $req_id: generateRequestId(),
            $user_agent: MODULE_VERSION,
            $user_application: USER_APP_VERSION,
            $cached,
            $push: true,
          },
          (response) => {
            this.sentVersions = true;
            if (response && response.$cached) {
              this.cache.clear(response);
            }
            callback();
          },
        );
      } else {
        this.sentVersions = true;
      }
    }

    return callback();
  }

  setAuthedEnv(response) {
    this.authed = true;
    this.authRequested = false;

    if (this.cache && response) {
      this.env = response.$env;
      this.cache.setEnv(response.$env);
    }

    if (this.connection) {
      this.connection.flushPendingBuffer();
    }
  }

  close() {
    if (this.connection) {
      this.connection.close();
      this.connection = null;
      this.authed = false;
      this.authRequested = false;
      this.sentVersions = false;
    }
  }

  static create(clientId, clientKey, options, callback) {
    return new Client(clientId, clientKey, options, callback);
  }
}

module.exports = Client;
