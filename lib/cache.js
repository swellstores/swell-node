const inherits = require('util').inherits;
const events = require('events');
const crypto = require('crypto');
const fs = require('fs');

const DEFAULT_STORAGE = 'shared-memory';
const DEFAULT_INDEX_LIMIT = 1000;

const Cache = function(clientId, options) {
  events.EventEmitter.call(this);

  this.versions = null;
  this.indexes = null;
  this.storage = null;

  options = options || {};
  if (typeof options === 'string') {
    options = { path: options };
  }

  this.params = {
    clientId: clientId,
    path: options.path ? String(options.path) : '',
    storage: options.storage || DEFAULT_STORAGE,
    indexLimit: options.indexLimit || DEFAULT_INDEX_LIMIT,
  };

  switch (this.params.storage) {
    case 'memory':
      this.storage = new MemoryStorage();
      break;
    case 'shared-memory':
      this.storage = new SharedMemoryStorage();
      break;
    default:
      throw new Error(this.params.storage + ' storage is not currently supported');
  }
};

inherits(Cache, events.EventEmitter);

/**
 * Get result from cache by url/data
 *
 * @param  string url
 * @param  mixed data
 */
Cache.prototype.get = function(url, data) {
  data = data || null;

  const cacheKey = this.getKey(url, data);
  const result = this.getCache(cacheKey, 'result');

  if (result) {
    // Ensure cache_key exists in index
    this.getIndex();
    if (result.$collection !== undefined) {
      const collection = result.$collection;
      if (this.indexes[collection] && this.indexes[collection][cacheKey]) {
        return result;
      }
    }

    // Not found in proper index, then clear?
    const resultCollections = this.resultCollections(result);
    for (const collection of resultCollections) {
      const where = {};
      where[collection] = cacheKey;
      this.clearIndexes(where);
    }
  }

  return null;
};

/**
 * Get a cache key
 *
 * @param  string url
 * @param  mixed data
 * @return string
 */
Cache.prototype.getKey = function(url, data) {
  data = data || null;
  const saneUrl = String(url)
    .trim()
    .replace(/^\/|\/$/g, '');
  const keyData = JSON.stringify([saneUrl, data]);
  return crypto
    .createHash('md5')
    .update(keyData)
    .digest('hex');
};

/**
 * Get path to a cache file
 *
 * @return string
 */
Cache.prototype.getPath = function(url, data) {
  return (
    this.params.path.replace(/\/$/, '') +
    '/client.' +
    this.params.clientId +
    '.' +
    Array.prototype.slice.call(arguments).join('.')
  );
};

/**
 * Get cache version info
 *
 * @return array
 */
Cache.prototype.getVersions = function() {
  if (!this.versions) {
    this.versions = this.getCache('versions') || {};
  }
  return this.versions;
};

/**
 * Get cache index info
 *
 * @return array
 */
Cache.prototype.getIndex = function() {
  if (!this.indexes) {
    this.indexes = this.getCache('index') || {};
  }
  return this.indexes;
};

/**
 * Reset objects, typically in between connections to avoid stale info
 */
Cache.prototype.reset = function() {
  this.indexes = null;
  this.versions = null;
};

/**
 * Put cache result in storage atomicly
 *
 * @param  string url
 * @param  mixed data
 * @param  mixed result
 */
Cache.prototype.put = function(url, data, result) {
  if (result.$data === undefined) {
    result.$data = null; // Allows for null response
  }

  this.getVersions();

  const cacheContent = {};
  const keys = Object.keys(result);
  for (const key of keys) {
    cacheContent[key] = result[key];
  }
  cacheContent.$cached = true;

  const cacheKey = this.getKey(url, data);
  const cachePath = this.getPath(cacheKey, 'result');

  const size = this.writeCache(cachePath, cacheContent);

  if (size > 0) {
    if (result.$cached !== undefined) {
      const cached = result.$cached;
      const resultCollections = this.resultCollections(result);
      for (const collection of resultCollections) {
        // Collection may not be cacheable
        if (cached[collection] === undefined && this.versions[collection] === undefined) {
          continue;
        }
        this.putIndex(collection, cacheKey, size);
        if (cached[collection] !== undefined) {
          this.putVersion(collection, cached[collection]);
        }
      }
    }
  }
};

/**
 * Update/write the cache index
 *
 * @param  string collection
 * @param  string key
 * @param  string size
 */
Cache.prototype.putIndex = function(collection, key, size) {
  this.getIndex();

  // Limit size of index per client/collection
  if (this.indexes[collection] !== undefined) {
    if (Object.keys(this.indexes[collection]).length >= this.params.indexLimit) {
      this.truncateIndex(collection);
    }
  }

  this.indexes[collection] = this.indexes[collection] || {};
  this.indexes[collection][key] = size;

  const indexPath = this.getPath('index');

  return this.writeCache(indexPath, this.indexes);
};

/**
 * Remove an entry from cache base on url and data
 * This is mostly used for caching variables as opposed to client results
 *
 * @param  string url
 * @param  mixed data
 */
Cache.prototype.remove = function(url, data) {
  data = data || null;
  const cacheKey = this.getKey(url, data);
  const cachePath = this.getPath(cacheKey, 'result');
  this.clearCache(cachePath);
};

/**
 * Truncate the cache index (usually by 1)
 * Prefers to eject the smallest cache content first
 *
 * @param  string collection
 * @return bool
 */
Cache.prototype.truncateIndex = function(collection) {
  this.getIndex();
  if (this.indexes[collection] === undefined) {
    return;
  }
  const keys = Object.keys(this.indexes[collection]);
  const lastKey = keys[keys.length - 1];
  const invalid = {};
  invalid[collection] = lastKey;
  this.clearIndexes(invalid);
};

/**
 * Update/write the cache version file
 *
 * @param  string collection
 * @param  number version
 * @return number
 */
Cache.prototype.putVersion = function(collection, version) {
  if (!version) {
    return;
  }
  this.getVersions();
  this.versions[collection] = version;
  const versionPath = this.getPath('versions');
  this.writeCache(versionPath, this.versions);
};

/**
 * Clear all cache entries made invalid by result
 *
 * @param  mixed result
 */
Cache.prototype.clear = function(result) {
  if (result.$cached === undefined) {
    return;
  }

  this.getVersions();

  const invalid = {};
  const cachedCollections = Object.keys(result.$cached);
  for (const collection of cachedCollections) {
    const version = result.$cached[collection];
    if (this.versions[collection] === undefined || version !== this.versions[collection]) {
      this.putVersion(collection, version);
      invalid[collection] = true;
      // Hack to make admin.settings affect other api.settings
      // TODO: figure out how to do this on the server side
      if (collection === 'admin.settings') {
        const versionCollections = Object.keys(this.versions);
        for (const verCollection of versionCollections) {
          if (String(verCollection).match(/\.settings$/)) {
            invalid[verCollection] = true;
          }
        }
      }
    }
  }

  if (Object.keys(invalid).length > 0) {
    this.clearIndexes(invalid);
  }
};

/**
 * Clear cache index for a certain collection
 *
 * @param  array invalid
 */
Cache.prototype.clearIndexes = function(invalid) {
  if (!invalid || Object.keys(invalid).length === 0) {
    return;
  }

  this.getIndex();
  const invalidCollections = Object.keys(invalid);
  for (const collection of invalidCollections) {
    if (this.indexes[collection] !== undefined) {
      if (invalid[collection] === true) {
        // Clear all indexes per collection
        const cacheKeys = Object.keys(this.indexes[collection]);
        for (const key of cacheKeys) {
          const cachePath = this.getPath(key, 'result');
          this.clearCache(cachePath);
          delete this.indexes[collection][key];
        }
      } else if (
        invalid[collection] &&
        this.indexes[collection][invalid[collection]] !== undefined
      ) {
        // Clear a single index element by key
        const key = invalid[collection];
        const cachePath = this.getPath(key, 'result');
        this.clearCache(cachePath);
        delete this.indexes[collection][key];
      }
    }
  }

  const indexPath = this.getPath('index');
  this.writeCache(indexPath, this.indexes);
};

/**
 * Get cache content
 *
 * @return string
 */
Cache.prototype.getCache = function() {
  const cachePath = this.getPath.apply(this, arguments);
  const cacheContent = this.storage.read(cachePath);
  if (cacheContent !== undefined) {
    return JSON.parse(cacheContent);
  }
  return null;
};

/**
 * Write to cache atomically
 *
 * @param  string cachePath
 * @param  mixed content
 * @return number
 */
Cache.prototype.writeCache = function(cachePath, content) {
  const cacheContent = JSON.stringify(content);
  const cacheSize = cacheContent.length;

  this.storage.write(cachePath, cacheContent);

  return cacheSize;
};

/**
 * Clear a cache path
 *
 * @param  string cachePath
 */
Cache.prototype.clearCache = function(cachePath) {
  this.storage.remove(cachePath);
};

/**
 * Get array of collections affected by a result
 *
 * @param  array result
 * @return array
 */
Cache.prototype.resultCollections = function(result) {
  const collections = result.$collection !== undefined ? [result.$collection] : [];
  // Combine $collection and $expanded headers
  if (result.$expanded !== undefined) {
    for (const expCollection of result.$expanded) {
      if (collections.indexOf(expCollection) === -1) {
        collections.push(expCollection);
      }
    }
  }
  return collections;
};


// Memory used by this instance only
function MemoryStorage() {
  this.memory = {};
}

MemoryStorage.prototype.read = function(key) {
  return this.memory[key];
};

MemoryStorage.prototype.write = function(key, value) {
  this.memory[key] = value;
};

MemoryStorage.prototype.remove = function(key) {
  delete this.memory[key];
};


// Memory used by all instances in this process
function SharedMemoryStorage() {
  if (!SharedMemoryStorage.memory) {
    SharedMemoryStorage.memory = {};
  }
  this.memory = SharedMemoryStorage.memory;
}

SharedMemoryStorage.prototype.read = function(key) {
  return this.memory[key];
};

SharedMemoryStorage.prototype.write = function(key, value) {
  this.memory[key] = value;
};

SharedMemoryStorage.prototype.remove = function(key) {
  delete this.memory[key];
};


// Exports
exports.Cache = Cache;
exports.MemoryStorage = MemoryStorage;
exports.SharedMemoryStorage = SharedMemoryStorage;
