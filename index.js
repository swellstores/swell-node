const Swell = require('./lib/client.js');

module.exports = new Swell.Client();
module.exports.createClient = Swell.createClient;
