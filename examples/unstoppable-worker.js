var forkie = require('../');
require('log-prefix')('WORKER PID/' + process.pid + ' says:');

var worker = forkie.worker('unstoppable worker', {
  start: function(cb) {
    console.log('starting');
    cb();
  },
  stop: function(cb) {
    console.log('stopping');
    setTimeout(cb, 1000)
  }
});

setInterval(function() {
  console.log('nobody can stop meeeeeeeee!');
}, 200);