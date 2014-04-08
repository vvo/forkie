'use strict';

module.exports = master;

function master(toFork, opts) {
  var debug = require('debug')('forkie:master');
  var path = require('path');
  var merge = require('deepmerge');
  var async = require('async');
  var workers;
  var repl;
  var shutdown;

  opts = merge({
    start: process.nextTick,
    stop: process.nextTick,
    killTimeout: 5 * 1000,
    restarts: false,

    // see https://github.com/dshaw/replify#options
    repl: false
  }, opts || {});

  if (opts.restarts === -1) {
    opts.restarts = Infinity
  }

  if (opts.repl && opts.repl.path) {
    opts.repl.path = path.resolve(opts.repl.path);
  }

  // a master is  a worker with a specific behavior
  var masterWorker = require('./worker.js')('master process', {
    start: async.series.bind(async, [opts.start, start]),
    stop: async.series.bind(async, [opts.stop, stop])
  });

  var forks = [];

  function start(cb) {
    debug('starting master %j', toFork);

    workers = toFork.map(function(what) {
      var autoRestart;
      var manualRestart;

      return {
        id: forks.push(null) - 1,
        toFork: what,
        title: 'no title yet',
        status: 'unknown',
        start: function start(cb) {
          debug('starting clusterWorker %s', what);

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

          if (clusterWorker.restarts.allowed !== false &&
            clusterWorker.restarts.automatic < clusterWorker.restarts.allowed) {

            forks[clusterWorker.id].once('exit', function(code, signal) {
              if (shutdown) {
                return;
              }

              // if `signal` is defined, it means
              //  - master killed the worker
              //  - someone from the outside killed the worker
              // In both cases, we do not want to restart the worker
              // If you want to restart the worker, use the REPL
              if (code === 0 || signal) {
                masterWorker.emit('worker stopped', clusterWorker, {
                  code: code,
                  signal: signal
                });

                debug('worker stopped at exit restart');
                clusterWorker.status = 'stopped';
                forks[clusterWorker.id] = null;
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

          } else {
            forks[clusterWorker.id].once('exit', function workerStopped(code, signal) {
              if (shutdown) {
                return;
              }

              masterWorker.emit('worker stopped', clusterWorker, {
                code: code,
                signal: signal
              });

              debug('worker stopped at exit start');

              clusterWorker.status = 'stopped';
              forks[clusterWorker.id] = null;
            });
          }

          async.series([
            waitForReady.bind(null, clusterWorker),
            startWorker.bind(null, clusterWorker)
          ], function workerStarted(err) {
            if (err) {
              return cb(err);
            }

            clusterWorker.status = 'started';

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
              debug('worker stopped at kill', code, signal);
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
      repl.on('listening', function emitREPLAddress() {
        masterWorker.emit('repl', this.address());
      });
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
        // when repl failed to start, dont fail at closing it
        try { repl.close() } catch (er) {}
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
    forked.once('exit', cancel);
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
    var forkedProcess = forked.process || forked;

    var exitCode = forkedProcess.exitCode;
    var signalCode = forkedProcess.signalCode;
    var connected = forkedProcess.connected;

    // already exited
    if (( exitCode !== null && exitCode !== undefined ) ||
        ( signalCode !== null && signalCode !== undefined )) {
      return process.nextTick(cb);
    }

    if (forkedProcess.connected === true) {
      debug('asking for graceful stop');
      forkedProcess.send({graceful: {action: 'stop'}});
    } else {
      debug('worker was not connected, disconnecting');
      forkedProcess.kill();
    }

    var forceKill = forkedProcess.kill.bind(forkedProcess, 'SIGKILL');
    var killTimeout = setTimeout(forceKill, opts.killTimeout);

    forkedProcess.once('exit', function waitForExit(code, signal) {
      clearTimeout(killTimeout);
      cb(null, code, signal);
    });
  }

  function startWorker(clusterWorker, cb) {
    var forked = forks[clusterWorker.id];
    var startTimeout = setTimeout(cb.bind(null, new Error('Worker could not be started')), 10 * 1000);

    forked.once('exit', cancel);
    function cancel(code, signal) {
      clearTimeout(startTimeout);

      // edge case, stop called
      //  - after we ask for a start
      //  - before we get the started message
      if (signal !== null) {
        return;
      }

      // worker failed to start and exited immediately, continue
      // so that we start other processes
      masterWorker.emit('worker error, cannot start', clusterWorker, code);
      cb(null);
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

  return masterWorker;
}