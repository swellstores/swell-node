const EventEmitter = require('events');
const crypto = require('crypto');
const fs = require('fs');

const DEFAULT_STORAGE = 'shared-memory';
const DEFAULT_INDEX_LIMIT = 1000;

class Cache extends EventEmitter {
  constructor(clientId, options) {
    super();

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
      env: options.env,
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
  }

  get(url, data) {
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
  }

  // Get a cache key
  getKey(url, data) {
    data = data || null;
    const saneUrl = String(url)
      .trim()
      .replace(/^\/|\/$/g, '');
    const keyData = JSON.stringify([saneUrl, data]);
    return crypto.createHash('md5').update(keyData).digest('hex');
  }

  // Get path to a cache file
  getPath(url, data) {
    let path =
      this.params.path.replace(/\/$/, '') +
      '/client.' +
      this.params.clientId +
      '.';

    if (this.params.env) {
      path +=
        this.params.env +
        '.';
    }

    path += Array.prototype.slice.call(arguments).join('.');

    return path;
  }

  // Get cache version info
  getVersions() {
    return this.versions = this.getCache('versions') || {};
  }

  // Get cache index info
  getIndex() {
    this.indexes = this.getCache('index') || {};
    return this.indexes;
  }

  // Reset objects, typically in between connections to avoid stale info
  reset() {
    this.indexes = null;
    this.versions = null;
  }

  // Put cache result in storage atomicly
  put(url, data, result) {
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
  }

  // Update/write the cache index
  putIndex(collection, key, size) {
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
  }

  // Remove an entry from cache base on url and data
  // This is mostly used for caching variables as opposed to client results
  remove(url, data) {
    data = data || null;
    const cacheKey = this.getKey(url, data);
    const cachePath = this.getPath(cacheKey, 'result');
    this.clearCache(cachePath);
  }

  // Truncate the cache index (usually by 1)
  // Prefers to eject the smallest cache content first
  truncateIndex(collection) {
    this.getIndex();
    if (this.indexes[collection] === undefined) {
      return;
    }
    const keys = Object.keys(this.indexes[collection]);
    const lastKey = keys[keys.length - 1];
    const invalid = {};
    invalid[collection] = lastKey;
    this.clearIndexes(invalid);
  }

  // Update/write the cache version file
  putVersion(collection, version) {
    if (!version) {
      return;
    }
    this.getVersions();
    this.versions[collection] = version;
    const versionPath = this.getPath('versions');
    this.writeCache(versionPath, this.versions);
  }

  // Clear all cache entries made invalid by result
  clear(result) {
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
  }

  // Clear cache index for a certain collection
  clearIndexes(invalid) {
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
  }

  // Get cache content
  getCache() {
    const cachePath = this.getPath.apply(this, arguments);
    const cacheContent = this.storage.read(cachePath);
    if (cacheContent !== undefined) {
      return JSON.parse(cacheContent);
    }
    return null;
  }

  // Write to cache atomically
  writeCache(cachePath, content) {
    const cacheContent = JSON.stringify(content);
    const cacheSize = cacheContent.length;

    this.storage.write(cachePath, cacheContent);

    return cacheSize;
  }

  // Clear a cache path
  clearCache(cachePath) {
    this.storage.remove(cachePath);
  }

  // Get array of collections affected by a result
  resultCollections(result) {
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
  }
}

// Memory used by this instance only
class MemoryStorage {
  memory = {};

  read(key) {
    return this.memory[key];
  }

  write(key, value) {
    this.memory[key] = value;
  }

  remove(key) {
    delete this.memory[key];
  }
}

// Memory used by all instances in this process
class SharedMemoryStorage {
  memory = {};

  constructor() {
    if (!SharedMemoryStorage.memory) {
      SharedMemoryStorage.memory = {};
    }
    this.memory = SharedMemoryStorage.memory;
  }

  read(key) {
    return this.memory[key];
  }

  write(key, value) {
    this.memory[key] = value;
  }

  remove(key) {
    delete this.memory[key];
  }
}

module.exports = Cache;
module.exports.MemoryStorage = MemoryStorage;
module.exports.SharedMemoryStorage = SharedMemoryStorage;
