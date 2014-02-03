'use strict';

module.exports = master;

function master(toFork, opts) {
  var merge = require('deepmerge');
  var async = require('async');
  var worker = require('./worker.js');
  var forks;

  opts = merge({
    start: process.nextTick,
    stop: process.nextTick,
    killTimeout: 5 * 1000,
    restarts: false
  }, opts || {});

  var worker = worker('master process', {
    start: async.compose(start, opts.start),
    stop: async.compose(stop, opts.stop),
  });

  function start(cb) {
    forks = toFork.map(fork);
    async.each(forks, startFork, cb);
  }

  function stop(cb) {
    async.each(forks, waitForExit, cb);
    forks.forEach(kill);

    function kill(fork) {
      if (fork.connected === true) {
        fork.send({graceful: {action: 'stop'}});
      } else {
        fork.kill();
      }
    }

    function waitForExit(proc, cb) {
      var forceKill = proc.kill.bind(proc, 'SIGKILL');
      var killTimeout = setTimeout(forceKill, opts.killTimeout);

      proc.once('exit', workerExited);

      function workerExited(code, signal) {
        clearTimeout(killTimeout);

        var metas = {
          title: proc.title
        };

        // when signal is empty, it means worker shut down gracefully
        if (signal) {
          metas.signal = signal;
        }

        if (code !== undefined) {
          metas.code = code;
        }

        worker.emit('worker stopped', metas);
        cb();
      }
    }
  }

  function fork(toFork) {
    var fork = require('child_process').fork;

    if (typeof toFork !== 'string') {
      // fork is a cluster obj
      // http://nodejs.org/api/cluster.html
      return toFork.fork();
    } else {
      return fork(toFork);
    }
  }

  function startFork(forkedProcess, cb) {
    forkedProcess.on('message', handleWorkerMessage);

    function handleWorkerMessage(msg) {
      if (msg && msg.graceful && msg.graceful.status) {

        if (msg.graceful.status !== 'stopped') {
          worker.emit('worker ' + msg.graceful.status, {
            title: msg.graceful.title
          });
        }

        switch(msg.graceful.status) {
          case 'ready':
            forkedProcess.title = msg.graceful.title;
            forkedProcess.send({graceful: {action: 'start'}});
            break;
          case 'started':
            cb();
            break;
        }
      }
    }
  }

  return worker;
}