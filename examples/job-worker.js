// run with node examples/job-worker.js
// will stop after 2 seconds

var forkie = require('../');
var async = require('async');
var queue = async.queue(jobWorker, 0);
require('log-prefix')('WORKER PID/' + process.pid + ' says:');

var worker = forkie.worker('some worker ' + Date.now() , {
  start: function(cb) {
    console.log('starting');
    queue.concurrency = 1;
    cb();
  },
  stop: function(cb) {
    clearInterval(interval);
    queue.concurrency = 0;
    console.log('stopping');
    console.log('queue had ' + queue.length() + ' remaining items');

    setTimeout(cb, 400);
  }
});

function jobWorker(time, cb) {
  // using forkie ensures that both of the asynchronous
  // timeouts will be executed even when asked to stops
  worker.working(true);
  console.log('time was ' + time);
  setTimeout(function() {
    console.log('time is now ' + Date.now());
    setTimeout(cb, 150);
  }, 10);
}

var interval = setInterval(function() {
  queue.push(Date.now(), function() {
    // setting working to false after each job
    // has completed ensures job full completion
    worker.working(false);
  });
}, 25);

if (!process.send) {
  setTimeout(function() {
    process.emit('SIGTERM')
  }, 1000);
}
