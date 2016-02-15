'use strict';

module.exports = worker;

/**
 * Turn a regular node.js process into a graceful process
 *   this process will be able to gracefully start and stop instead
 *   of exiting brutally
 * @param  {String} title process title, will be sent back to master when ready
 * @param  {Object} fns, provide a fns.start and fn.stop Function to be called when exiting
 * @return {EventEmitter} worker
 */
function worker(title, fns) {
  var debug = require('debug')('forkie:worker');
  var EventEmitter = require('events').EventEmitter;

  var emitter = new EventEmitter();
  var isWorking;
  var exitAsked;

  var graceful = {
    start: function() {
      fns.start(function() {
        debug('"%s"/%d starting...', title, process.pid);
        if (process.send) {
          process.send({graceful: {status: 'started', title: title}});
        }

        emitter.emit('started');
      });
    },
    stop: function() {
      debug('"%s"/%d stopping...', title, process.pid);
      teardown();
      fns.stop(function() {
        if (process.send) {
          process.send({graceful: {status: 'stopped', title: title}});
        }

        emitter.emit('stopped');
      });
    }
  };

  var exitSignalHandler = handleMasterMessage.bind(null, {graceful: {action: 'stop'}}, true);
  var exitSignals = ['SIGTERM', 'SIGINT'];

  // let people subscribe to events
  process.nextTick(init);

  function init() {
    // process was forked, we wait for the master to ask us for a start
    if (process.send) {
      process.addListener('message', handleMasterMessage);
      process.addListener('disconnect', masterDied);
      process.send({graceful: {status:'ready', title: title}});
      emitter.emit('ready');
    } else {
      graceful.start();
    }

    exitSignals.forEach(subscribe);
  }

  function teardown() {
    if (process.send)
      process.removeListener('message', handleMasterMessage);
    exitSignals.forEach(unsubscribe);
  }

  function subscribe(signal) {
    debug('"%s"/%d subscribing to signal %s', title, process.pid, signal);
    process.addListener(signal, exitSignalHandler);
  }

  function unsubscribe(signal) {
    debug('"%s"/%d unsubscribing from signal %s', title, process.pid, signal);
    try {
      process.removeListener(signal, exitSignalHandler);
    } catch (e) {
      // we don't care
    }
  }

  function handleMasterMessage(msg/*, quit */) {
    var quit = arguments[1];
    if (!quit) {
      debug('"%s"/%d received %j from master', title, process.pid, msg);
    } else {
      debug('"%s"/%d was asked by signal to quit', title, process.pid);
    }

    if (msg && msg.graceful && msg.graceful.action) {
      switch(msg.graceful.action) {
        case 'start':
          graceful.start();
          break;
        case 'stop':
          if (exitAsked)
            return;

          exitAsked = true;

          if (!isWorking)
            graceful.stop();

          break;
        default:
          console.error('Unknown msg.graceful.action ! ' + msg.graceful.action);
          debug('"%s"/%d Unknown msg.graceful.action ! ' + msg.graceful.action, title, process.pid);
          break;
      }
    }
  }

  emitter.working = function setWorking(status) {
    isWorking = status;

    if (isWorking === false && exitAsked) {
      graceful.stop();
    }
  };

  function masterDied() {
    console.error('"%s"/%d Master process died, forced exit', title, process.pid);
    process.nextTick(process.exit.bind(process, 1));
  }

  return emitter;
}
