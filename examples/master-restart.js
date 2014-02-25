var forkie = require('../');
var path = require('path');
var failWorker = path.join(__dirname, 'failed-worker.js');
require('log-prefix')('MASTER PID/' + process.pid + ' says:');

var master = forkie.master([ failWorker ], {
  restarts: Infinity
});

['ready', 'started', 'stopped', 'killed', 'restarted'].forEach(logEvent);

function logEvent(name) {
  master.on('worker '+ name, function(params) {
    console.log(name + ': ' + JSON.stringify(params));
  });
}

master.on('stopped', function() {
  console.log('exiting master');
});