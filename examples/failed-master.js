// run with examples/master.js
// a failed master, with a failed worker, both should exit

var forkie = require('../');
var path = require('path');
var unstoppableWorker = path.join(__dirname, 'unstoppable-worker.js');

require('log-prefix')('MASTER PID/' + process.pid + ' says:');
var masterLog;
var master = forkie.master([
  unstoppableWorker
], {
  restarts: -1,
  start: function(cb) {
    masterLog = setInterval(function() {
      console.log('master is alive')
    }, 250);
    console.log('will start workers in 500ms');
    setTimeout(cb, 500);
  },
  stop: function(cb) {
    clearInterval(masterLog);
    console.log('will stop workers in 100ms');
    setTimeout(cb, 100);
    setTimeout(function() {
      process.exit(1);
    }, 200)
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
}, 2230);