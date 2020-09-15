const events = require('events');
const crypto = require('crypto');
const inherits = require('util').inherits;
const Promise = require('bluebird').Promise;

const Swell = require('./swell');
Swell.Connection = require('./connection').Connection;
Swell.Cache = require('./cache').Cache;

const DEFAULT_HOST = 'api.swell.store';
const DEFAULT_PORT = 8443;
const DEFAULT_VERIFY_CERT = true;
const DEFAULT_VERSION = 1;

const Client = function(clientId, clientKey, options, callback) {
  events.EventEmitter.call(this);

  this.server = null;
  this.cache = null;

  if (clientId) {
    this.init(clientId, clientKey, options);
  }
  if (callback) {
    this.connect(callback);
  }
};

inherits(Client, events.EventEmitter);

Client.prototype.init = function(clientId, clientKey, options) {
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
    cache: typeof options.cache !== 'undefined' ? options.cache : true,
  };

  if (!this.params.clientId) {
    throw new Error('Swell store `id` is required to connect');
  }
  if (!this.params.clientKey) {
    throw new Error('Swell store `key` is required to connect');
  }

  return this;
};

Client.prototype.connect = function(callback) {
  this.server = new Swell.Connection(
    this.params.host,
    this.params.port,
    {
      verifyCert: this.params.verifyCert,
      timeout: this.params.timeout,
    },
    () => {
      callback && callback(this);
      this.emit('connect', this);
    },
  );
  this.server.on('close', () => {
    this.emit('close');
  });
  this.server.on('error', (err) => {
    if (events.EventEmitter.listenerCount(this, 'error')) {
      this.emit('error', 'Error: ' + err);
    }
  });
  this.server.on('error.network', (err) => {
    if (events.EventEmitter.listenerCount(this, 'error')) {
      this.emit('error', 'Network error: ' + err, 'network');
    }
  });
  this.server.on('error.protocol', (err) => {
    if (events.EventEmitter.listenerCount(this, 'error')) {
      this.emit('error', 'Protocol error: ' + err, 'protocol');
    }
  });
  this.server.on('error.server', (err) => {
    if (events.EventEmitter.listenerCount(this, 'error')) {
      this.emit('error', 'Server error: ' + err, 'server');
    }
  });
};

Client.prototype.request = function(method, url, data, callback) {
  if (typeof data === 'function') {
    callback = data;
    data = null;
  }

  if (!this.cache && this.params.cache) {
    const clientId = this.params.routeClientId || this.params.clientId;
    this.cache = new Swell.Cache(clientId, this.params.cache);
  }

  if (!this.server) {
    this.connect();
  }

  // Resolve data as promised
  const promises = this.promisifyData(data);
  if (promises.length) {
    return Promise.all(promises)
      .bind(this)
      .then(() => {
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
    }
  }

  return new Promise((resolve, reject) => {
    const responder = (err, data, response) => {
      if (callback) {
        callback(err, data, response);
      }
      if (err) {
        reject(new Error(err));
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
          this.authed = true;
          return this.auth(response.$auth, (response) => {
            return this.respond(method, url, data, response, responder);
          });
        }
      } else {
        return this.respond(method, url, data, response, responder);
      }
    });
  });
};

Client.prototype.promisifyData = function(data) {
  if (!data) {
    return [];
  }

  function thenResolvePromisedValue(data, key) {
    data[key].then(function(val) {
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
    for (const i = 0; i < data.length; i++) {
      if (data[i] && data[i].then) {
        promises.push(data[i]);
        thenResolvePromisedValue(data, i);
      }
    }
  }

  return promises;
};

Client.prototype.respond = function(method, url, request, response, callback) {
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
};

Client.prototype.get = function(url, data, callback) {
  if (this.cache) {
    if (typeof data === 'function') {
      callback = data;
      data = null;
    }

    return this.getCacheResult(url, data).then((result) => {
      if (result) {
        if (callback) {
          return callback(null, result);
        }
        return result;
      }
      return this.request('get', url, data, callback);
    });
  }

  return this.request('get', url, data, callback);
};

Client.prototype.getCacheResult = function(url, data) {
  return new Promise((resolve) => {
    const response = this.cache.get(url, data);
    if (!response || response.$data === undefined) {
      return resolve();
    }

    if (!this.cacheUpdateTime) {
      this.cacheUpdateTime = Date.now();
    } else if (Date.now() - this.cacheUpdateTime > 1000) {
      this.cacheUpdateTime = Date.now();
      const $cached = this.cache.getVersions();
      $cached.client = this.params.routeClientId || this.params.clientId;
      this.server.request('cached', $cached, (cachedResponse) => {
        this.cache.clear(cachedResponse);
        resolve(this.getCacheResult(url, data));
      });
      return;
    }

    resolve(response.$data);
  });
};

Client.prototype.put = function(url, data, callback) {
  return this.request('put', url, data, callback);
};

Client.prototype.post = function(url, data, callback) {
  return this.request('post', url, data, callback);
};

Client.prototype.delete = function(url, data, callback) {
  return this.request('delete', url, data, callback);
};

Client.prototype.auth = function(nonce, callback) {
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
    return this.server.request('auth', (nonce) => {
      this.auth(nonce, callback);
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
  }

  // TODO: send local $ip address

  return this.server.request('auth', creds, callback);
};

Client.prototype.close = function() {
  if (this.server) {
    this.server.close();
  }
};

Client.create = function(clientId, clientKey, options, callback) {
  return new Client(clientId, clientKey, options, callback);
};

Client.createResource = function(url, response, client) {
  if (response && response.$data && 'count' in response.$data && response.$data.results) {
    return new Swell.Collection(url, response, client);
  }
  return new Swell.Record(url, response, client);
};

module.exports = Swell;
module.exports.Client = Client;
module.exports.createClient = Client.create;
