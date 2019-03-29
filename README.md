## Swell API library for NodeJS

Build and scale ecommerce with Swell.

## Install

    npm install swell-node --save

## Connect

```javascript
const swell = require('swell-node');

swell.init('my-store', 'secret-key');
```

## Usage

```javascript
try {
  const products = await swell.get('/products', { active: true });
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

Coming soon!

## Contributing

Pull requests are welcome

## License

MIT
