var static = require('serve-static');

var fileServer = static('./public');

require('http').createServer(function (request, response) {
    fileServer(request, response)
}).listen(8080);