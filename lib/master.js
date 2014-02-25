'use strict';

module.exports = master;

function master(toFork, opts) {
  var merge = require('deepmerge');
  var async = require('async');
  var workers;
  var repl;
  var manualRestart;
  var shutdown;

  opts = merge({
    start: process.nextTick,
    stop: process.nextTick,
    killTimeout: 5 * 1000,
    restarts: false,

    // see https://github.com/dshaw/replify#options
    repl: false
  }, opts || {});

  // a master is  a worker with a specific behavior
  var masterWorker = require('./worker.js')('master process', {
    start: async.series.bind(async, [opts.start, start]),
    stop: async.series.bind(async, [opts.stop, stop])
  });

  var forks = [];

  function start(cb) {
    workers = toFork.map(function(what) {
      return {
        id: forks.push(null) - 1,
        toFork: what,
        status: null,
        start: function start(cb) {
          if (!cb) {
            cb = function() {}
          }

          var clusterWorker = this;

          if (forks[clusterWorker.id] !== null) {
            var err = new Error('Cannot start a started worker');
            masterWorker.emit('worker error', clusterWorker, err);
            return process.nextTick(cb.bind(null, err));
          }

          forks[clusterWorker.id] = fork(clusterWorker);

          async.series([
            waitForReady.bind(null, clusterWorker),
            startWorker.bind(null, clusterWorker)
          ], function workerStarted(err) {
            if (err) {
              return cb(err);
            }

            clusterWorker.status = 'started';

            if (clusterWorker.restarts.allowed !== false &&
              clusterWorker.restarts.automatic < clusterWorker.restarts.allowed) {
              restartWhenFailing(clusterWorker);
            }

            masterWorker.emit('worker started', clusterWorker);
            manualRestart = false;

            cb(null);
          });
        },
        stop: function stop(cb) {
          if (!cb) {
            cb = function() { }
          }

          var clusterWorker = this;
          var err;

          if (forks[clusterWorker.id] === null) {
            if (shutdown) {
              err = null;
            } else {
              err = new Error('Cannot stop a stopped worker');
              masterWorker.emit('worker error', clusterWorker, err);
            }
            return process.nextTick(cb.bind(null, err));
          }

          forks[clusterWorker.id].removeAllListeners('message');
          clearTimeout(autoRestart);

          kill(clusterWorker, function killed(err, code, signal) {
            if (err) {
              return cb(err);
            }

            forks[clusterWorker.id] = null;
            clusterWorker.status = 'stopped';

            if (signal === 'SIGKILL') {
              // we were brutally killed
              masterWorker.emit('worker killed', clusterWorker);
            } else {
              masterWorker.emit('worker stopped', clusterWorker);
            }

            cb(null, code, signal);
          });
        },
        restart: function restart(cb) {
          if (manualRestart) {
            return;
          }

          manualRestart = true;

          var clusterWorker = this;
          clusterWorker.stop(function(err) {
            clusterWorker.start(cb);
            masterWorker.emit('worker restarted', clusterWorker);
            clusterWorker.restarts.manual ++;
          });
        },
        restarts: {
          allowed: opts.restarts,
          manual: 0,
          automatic: 0
        }
      }
    });

    if (opts.repl) {
      repl = require('./repl.js')(masterWorker, workers, opts.repl);
    }

    async.eachSeries(workers, function startWorker(clusterWorker, cb) {
      clusterWorker.start(cb);
    }, cb);
  }

  function stop(cb) {
    shutdown = true;
    async.each(workers, function stopWorker(clusterWorker, cb) {
      clusterWorker.stop(cb);
    }, function workedStopped(err) {
      if (repl && repl.close) {
        repl.close();
      }

      if (err) {
        return cb(err);
      }

      cb(null);
    });
  }

  function fork(clusterWorker) {
    var fork = require('child_process').fork;
    var forked;

    if (typeof clusterWorker.toFork !== 'string') {
      // fork is a cluster obj
      // http://nodejs.org/api/cluster.html
      forked = clusterWorker.toFork.fork();
    } else {
      forked = fork(clusterWorker.toFork);
    }

    return forked;
  }

  function waitForReady(clusterWorker, cb) {
    var forked = forks[clusterWorker.id];

    var readyTimeout = setTimeout(cb.bind(null, new Error('Worker could not be ready')), 10 * 1000);

    // edge case, stop called
    //  - after we ask for ready
    //  - before we get the ready message
    forked.on('exit', cancel);
    function cancel() {
      clearTimeout(readyTimeout);
    }

    forked.on('message', function waitForReady(msg) {
      if (!msg.graceful) {
        return;
      }

      if (msg.graceful.status === 'ready') {
        forked.removeListener('exit', cancel);
        clearTimeout(readyTimeout);
        clusterWorker.title = msg.graceful.title;
        clusterWorker.status = 'ready';
        forked.removeListener('message', waitForReady);
        masterWorker.emit('worker ready', clusterWorker);
        cb(null);
      }
    });
  }

  function kill(clusterWorker, cb) {
    var forked = forks[clusterWorker.id];

    // already exited
    if (forked.exitCode !== null) {
      return process.nextTick(cb);
    }

    if (forked.connected === true) {
      forked.send({graceful: {action: 'stop'}});
    } else {
      forked.kill();
    }

    var forceKill = forked.kill.bind(forked, 'SIGKILL');
    var killTimeout = setTimeout(forceKill, opts.killTimeout);

    forked.once('exit', function waitForExit(code, signal) {
      clearTimeout(killTimeout);
      cb(null, code, signal);
    });
  }

  function startWorker(clusterWorker, cb) {
    var forked = forks[clusterWorker.id];
    var startTimeout = setTimeout(cb.bind(null, new Error('Worker could not be started')), 10 * 1000);

    // edge case, stop called
    //  - after we ask for a start
    //  - before we get the started message
    forked.on('exit', cancel);
    function cancel() {
      clearTimeout(startTimeout);
    }

    forked.on('message', function waitForStart(msg) {
      if (!msg.graceful) {
        return;
      }

      if (msg.graceful.status === 'started') {
        forked.removeListener('exit', cancel);
        clearTimeout(startTimeout);
        forked.removeListener('message', waitForStart);
        cb(null);
      }
    });

    forks[clusterWorker.id].send({graceful: {action: 'start'}});
  }

  var autoRestart;
  function restartWhenFailing(clusterWorker) {
    forks[clusterWorker.id].once('exit', function(code, signal) {
      if (code === 0 && !signal) {
        return;
      }

      clearTimeout(autoRestart);
      autoRestart = setTimeout(function restart() {
        clusterWorker.restarts.automatic++;
        forks[clusterWorker.id] = null;
        clusterWorker.start();
        clusterWorker.status = 'restarting';
        masterWorker.emit('worker restarted', clusterWorker);
      }, 1 * 1000);
    });
  }

  return masterWorker;
}