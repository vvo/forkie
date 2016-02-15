'use strict';

module.exports = master;

function master(toFork, opts) {
  var debug = require('debug')('forkie:master');
  var path = require('path');
  var merge = require('deepmerge');
  var async = require('async');

  var workers = [];
  var repl;
  var shuttingDown = false;

  opts = merge({
    start: process.nextTick,
    stop: process.nextTick,
    killTimeout: 5 * 1000,
    restarts: false,
    // see https://github.com/dshaw/replify#options
    repl: false
  }, opts || {});

  if (opts.restarts === -1)
    opts.restarts = Infinity;

  if (opts.repl && opts.repl.path)
    opts.repl.path = path.resolve(opts.repl.path);

  // a master is  a worker with a specific behavior
  var masterWorker = require('./worker.js')('master process', {
    start: function (cb) {
      async.series([opts.start, start], cb)
    },
    stop: function (cb) {
      async.series([opts.stop, stop], cb)
    }
  });

  var forks = [];

  function start(cb) {
    debug('starting master with forks: %j', toFork);

    workers = toFork.map(function(what) {
      var autoRestart;
      var manualRestart;

      return {
        id: forks.push(null) - 1,
        toFork: what,
        title: '[' + what + ']',
        status: 'unknown',
        start: function start(cb) {
          var clusterWorker = this;
          debug('starting clusterWorker "%s"', clusterWorker.title);

          if (!cb)
            cb = function() {};

          if (forks[clusterWorker.id] !== null) {
            var err = new Error('Cannot start a started worker');
            masterWorker.emit('worker error', clusterWorker, err);
            return process.nextTick(cb.bind(null, err));
          }

          forks[clusterWorker.id] = fork(clusterWorker);

          if (clusterWorker.restarts.allowed !== false &&
            clusterWorker.restarts.automatic < clusterWorker.restarts.allowed) {

            forks[clusterWorker.id].once('exit', function(code, signal) {
              debug('worker "%s" exit detected', clusterWorker.title);

              if (shuttingDown)
                return;

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

              debug('attempting to restart worker "%s"...', clusterWorker.title);
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
              debug('worker "%s" exit detected', clusterWorker.title);

              if (shuttingDown)
                return;

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
            if (err) return cb(err);

            clusterWorker.status = 'started';

            masterWorker.emit('worker started', clusterWorker);
            manualRestart = false;

            cb(null);
          });
        },
        stop: function stop(cb) {
          var clusterWorker = this;
          debug('stopping clusterWorker "%s"', clusterWorker.title);

          if (!cb)
            cb = function() { };

          var err;

          if (forks[clusterWorker.id] === null) {
            if (!shuttingDown) {
              err = new Error('Cannot stop a stopped worker');
              masterWorker.emit('worker error', clusterWorker, err);
            }
            return process.nextTick(cb.bind(null, err));
          }

          forks[clusterWorker.id].removeAllListeners('message');
          clearTimeout(autoRestart);

          kill(clusterWorker, function killed(err, code, signal) {
            if (err) return cb(err);

            forks[clusterWorker.id] = null;
            clusterWorker.status = 'stopped';

            if (signal === 'SIGKILL') {
              // we were brutally killed
              masterWorker.emit('worker killed', clusterWorker);
            } else {
              debug('worker "%s" stopped at kill', clusterWorker.title, code, signal);
              masterWorker.emit('worker stopped', clusterWorker);
            }

            cb(null, code, signal);
          });
        },
        restart: function restart(cb) {
          var clusterWorker = this;
          debug('REstarting clusterWorker "%s"', clusterWorker.title);

          if (manualRestart) {
            // Note : should call back ??
            return;
          }

          manualRestart = true;

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
    debug('stopping master...');

    shuttingDown = true;
    async.each(workers, function stopWorker(clusterWorker, cb) {
      debug('ordering worker "%s" to stop...', clusterWorker.title);
      clusterWorker.stop(cb);
    }, function workedStopped(err) {

      if(err)
        debug('An error happened while stopping all workers : ' + err.message);
      else
        debug('all workers should have stopped.');

      if (repl && repl.close) {
        // when repl failed to start, don't fail at closing it
        try { repl.close() } catch (er) {}
      }

      return cb(err);
    });
  }

  function fork(clusterWorker) {
    var fork = require('child_process').fork;
    var forked;

    if (typeof clusterWorker.toFork !== 'string') {
      // fork is a cluster obj
      // http://nodejs.org/api/cluster.html
      debug('forking "%s" as cluster...', clusterWorker.title);
      forked = clusterWorker.toFork.fork();
    } else {
      debug('forking "%s" as child process...', clusterWorker.title);
      forked = fork(clusterWorker.toFork);
    }

    return forked;
  }

  function waitForReady(clusterWorker, cb) {
    debug('Waiting for worker "%s" readiness...', clusterWorker.title);
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
      if (!msg.graceful) return;

      if (msg.graceful.status === 'ready') {
        forked.removeListener('exit', cancel);
        clearTimeout(readyTimeout);
        clusterWorker.title = msg.graceful.title;
        clusterWorker.status = 'ready';
        forked.removeListener('message', waitForReady);
        debug('Worker "%s[%s]" signaled its readiness.', clusterWorker.title, clusterWorker.toFork);
        masterWorker.emit('worker ready', clusterWorker);
        cb(null);
      }
    });
  }

  function kill(clusterWorker, cb) {
    debug('Killing worker "%s"...', clusterWorker.title);

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
      debug('worker "%s" reported its exit.', clusterWorker.title);
      clearTimeout(killTimeout);
      cb(null, code, signal);
    });
  }

  function startWorker(clusterWorker, cb) {
    debug('Starting worker "%s"...', clusterWorker.title);

    var forked = forks[clusterWorker.id];
    var startTimeout = setTimeout(cb.bind(null, new Error('Worker could not be started')), 10 * 1000);

    forked.once('exit', cancel);
    function cancel(code, signal) {
      debug('worker "%s" reported its exit while we were starting it !', clusterWorker.title);
      clearTimeout(startTimeout);

      // edge case, stop called
      //  - after we ask for a start
      //  - before we get the started message
      if (signal !== null)
        return;

      // worker failed to start and exited immediately, continue
      // so that we start other processes
      masterWorker.emit('worker error, cannot start', clusterWorker, code);
      cb(null);
    }

    forked.on('message', function waitForStart(msg) {
      if (!msg.graceful) return;

      if (msg.graceful.status === 'started') {
        forked.removeListener('exit', cancel);
        clearTimeout(startTimeout);
        forked.removeListener('message', waitForStart);
        debug('Worker "%s" signaled it stated.', clusterWorker.title);
        cb(null);
      }
    });

    forks[clusterWorker.id].send({graceful: {action: 'start'}});
  }

  return masterWorker;
}
