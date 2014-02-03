forkie [![Build Status](https://travis-ci.org/vvo/forkie.png?branch=master)](https://travis-ci.org/vvo/forkie)
========

# Forkie

Forkie is a graceful process manager which allows you to:
- register workers:
  - nodejs modules
  - node.js [cluster](http://nodejs.org/api/cluster.html#cluster_cluster_fork_env) workers
- register start/stop hooks on master and workers
- get workers events: ready/started/stopped
- get master events: worker ready, worker started, worker stopped
- handle graceful stops (think long running jobs)

See the [examples](examples/).

# master API

A forkie master will forks all the workers you give to him.
Workers must implement the [worker API](#worker API).

```js
var workers = [
  'job-worker.js',
  'job-worker2.js',
  'job-worker2.js',
  require('cluster'),
  require('cluster')
];

var opts = {
  start: startMaster, // default: process.nextTick
  stop: stopMaster,   // default: process.nextTick
  killTimeout: 1500   // default: 5000ms
};

var master = require('forkie').master(workers, opts);

master.on('worker stopped', function(metas) {
  console.log(metas.title); // worker title, see worker API
  console.log(metas.code)   // exit code
  console.log(metas.signal) // exit signal, should be SIGKILL when killTimeout occurs
});

// on ready and started events, you get the `{ title: 'worker title' }`
master.on('worker ready', console.log);
master.on('worker started', console.log);

// this will be called before
// starting workers
function startMaster(cb) {
  setTimeout(cb, 3000);
}

// this will be called before
// stopping workers
function stopMaster(cb) {
  setTimeout(cb, 1500);
}
```

`killTimeout` is the amount of time in ms after which a worker has failed
to stop gracefully.

# worker API

The worker API can be used in conjunction with a
master process (master-worker) or as a standalone worker.

```js
var title = 'I am a worker';

var opts = {
  start: startWorker,
  stop: stopWorker
};

var worker = require('forkie').worker(title, opts);

worker.on('stopped', console.log);
worker.on('started', console.log);
worker.on('ready', console.log);

function startWorker(cb) {
  setTimeout(cb, 3000);
}

function stopWorker(cb) {
  setTimeout(cb, 1500);
}
```

By default, as soon as master receives a
SIGTERM or SIGINT, all workers are asked to stop.

## .working(true/false)

To inform forkie that you are dealing with long asynchronous tasks
and that you don't want to be interrupted, use `worker.working(true)`.

For example, when using a work queue,
before starting to work on a job, use `worker.working(true)`,
after dealing with a job, use `worker.working(false)`.

See [examples/job-worker.js](examples/job-worker.js) for
a more concrete example.

# Graceful exit

Forkie will not call `process.exit()` for you.
All you workers must terminate their respective
connections and async loops in the `stop` method.

So that your process exits by itself.

When in a master-worker setup, your worker will be killed
after `killTimeout` ms if it doesn't exits.

When in a standalone worker setup, your worker will
not exits if you don't terminate your connections.
