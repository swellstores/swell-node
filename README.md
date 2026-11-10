## Swell API library for NodeJS

[Swell](https://www.swell.is) is an ecommerce platform with subscriptions and B2B pricing built in. Run your store on a Swell theme, or [go headless](https://www.swell.is/headless-commerce) with its APIs.

## Install

    npm install swell-node --save

## Connect

```javascript
const { swell } = require('swell-node');

swell.init('my-store', 'secret-key');
```

To connect to multiple stores in the same process, use `swell.createClient()`:

```javascript
const { swell } = require('swell-node');

const client1 = swell.createClient('my-store-1', 'secret-key-1');
const client2 = swell.createClient('my-store-2', 'secret-key-2');
```

## Usage

```javascript
try {
  const { data } = await swell.get('/products', {
    active: true
  });
  console.log(data);
} catch (err) {
  console.error(err.message);
}
```

## Documentation

This library is intended for use with the Swell Backend API: https://developers.swell.is/backend-api

## Contributing

Pull requests are welcome

## License

MIT
