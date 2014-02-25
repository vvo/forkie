// once started, access the repl with
// using `npm install -g repl-client`
// and try help();

var forkie = require('../');
var path = require('path');
var workerFile = path.join(__dirname, 'job-worker.js');
require('log-prefix')('MASTER PID/' + process.pid + ' says:');

var master = forkie.master([ workerFile ], {
  repl: {
    name: 'master-repl',
    path: process.cwd()
  }
});

['ready', 'started', 'stopped', 'killed', 'restarted', 'error'].forEach(logEvent);

function logEvent(name) {
  master.on('worker '+ name, function(params, err) {
    console.log(name + ': ' + JSON.stringify(params));
    if (err) {
      console.log(err);
    }
  });
}

master.on('stopped', function() {
  console.log('exiting master');
});