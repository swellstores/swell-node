## Swell API library for NodeJS

[Swell](https://www.swell.is) is a customizable, API-first platform for powering modern B2C/B2B shopping experiences and marketplaces. Build and connect anything using your favorite technologies, and provide admins with an easy to use dashboard.

## Install

    npm install swell-node --save

## Connect

```javascript
const swell = require('swell-node');

swell.init('my-store', 'secret-key');
```

To connect to multiple stores in the same process, use `swell.createClient()`:

```javascript
const swell = require('swell-node');

const store1 = swell.createClient('my-store-1', 'secret-key-1');
const store2 = swell.createClient('my-store-2', 'secret-key-2');
```

## Usage

```javascript
try {
  const products = await swell.get('/products', {
    active: true
  });
  console.log(products);
} catch (err) {
  console.error(err);
}
```

## Caching

This library provides in-memory caching enabled by default, using a version protocol that means you don't have to worry about stale cache. Records that don't change too frequently, such as products, will always return from cache when possible.

To disable caching behavior, use the option `cache: false`.

```javascript
swell.init('my-store', 'secret-key', {
  cache: false,
});
```

## Documentation

This library is intended for use with the Swell Backend API: https://developers.swell.is/backend-api

## Contributing

Pull requests are welcome

## License

MIT
