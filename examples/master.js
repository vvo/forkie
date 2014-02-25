// run with examples/master.js

var forkie = require('../');
var path = require('path');
var workerFile = path.join(__dirname, 'job-worker.js');
var unstoppableWorker = path.join(__dirname, 'unstoppable-worker.js');
var failedWorker = path.join(__dirname, 'failed-worker.js');

require('log-prefix')('MASTER PID/' + process.pid + ' says:');
var masterLog;
var master = forkie.master([
  workerFile,
  workerFile,
  workerFile,
  workerFile,
  // should be killed with SIGKILL
  unstoppableWorker,
  failedWorker
], {
  start: function(cb) {
    masterLog = setInterval(function() {
      console.log('master is alive')
    }, 250);
    console.log('will start workers in 500ms');
    setTimeout(cb, 500);
  },
  stop: function(cb) {
    clearInterval(masterLog);
    console.log('will stop workers in 200ms');
    setTimeout(cb, 200)
  },
  killTimeout: 2000
});

['ready', 'started', 'stopped', 'killed'].forEach(logEvent);

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