var forkie = require('../');
require('log-prefix')('WORKER PID/' + process.pid + ' says:');

var worker = forkie.worker('failed worker', {
  start: function(cb) {
    console.log('starting');
    cb();
    process.nextTick(function() {
      throw 'BOUH'
    })
  },
  stop: function(cb) {
    console.log('stopping');
    cb();
  }
});

