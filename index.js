const Client = require('./lib/client.js');

module.exports = new Client();
module.exports.createClient = Client.create;
