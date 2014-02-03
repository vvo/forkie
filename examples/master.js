// run with examples/master.js

var forkie = require('../');
var path = require('path');
var workerFile = path.join(__dirname, 'job-worker.js');
var unstoppableWorker = path.join(__dirname, 'unstoppable-worker.js');
require('log-prefix')('MASTER PID/' + process.pid + ' says:');

var master = forkie.master([
  workerFile,
  workerFile,
  workerFile,
  workerFile,
  // should be killed with SIGKILL
  unstoppableWorker
], {
  start: function(cb) {
    console.log('will start workers in 500ms');
    setTimeout(cb, 500);
  },
  stop: function(cb) {
    console.log('will stop workers in 200ms');
    setTimeout(cb, 200)
  },
  killTimeout: 500
});

['ready', 'started', 'stopped'].forEach(logEvent);

function logEvent(name) {
  master.on('worker '+ name, function(params) {
    console.log(name + ': ' + JSON.stringify(params));
  });
}

master.on('stopped', function() {
  console.log('exiting master');
});

setTimeout(function() {
  process.emit('SIGTERM');
}, 1500);