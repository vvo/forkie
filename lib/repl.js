'use strict';

module.exports = repl;

function repl(master, workers, replifyOpts) {
  var clients = [];
  var debugging = true;

  var context = {
    workers: workers,
    debug: function activateDebugging() {
      debugging = !debugging;
    },
    help: function() {
      return [
        'Use theses commands to control your forkie cluster:',
        '---------',
        'workers - show current workers, start, stop, restart them',
        'debug() - activate/deactivate debugging messages (on by default)',
        'help()  - show help'
      ]
    }
  };

  ['ready', 'started', 'stopped', 'restarted', 'killed', 'error'].forEach(logEvents);

  function logEvents(name) {
    var evName = 'worker ' + name;
    master.on(evName, debug.bind(null, evName))
  }

  function debug(message, clusterWorker, moreInfo) {
    if (!debugging) {
      return;
    }

    clients.forEach(function write(socket) {
      socket.write(clusterWorker.id + '/' + clusterWorker.title + ': ' + message + (moreInfo && ' /' + moreInfo || '') + '\n');
    });
  }

  var server = require('replify')(replifyOpts, {}, context);

  server.on('connection', addSocket);

  function addSocket(socket) {
    socket.unref();
    clients.push(socket);
    socket.on('close', removeSocket);
  }

  function removeSocket() {
    clients.splice(clients.indexOf(this), 1);
  }

  return server;
}
