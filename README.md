# Forkie [![Build Status](https://travis-ci.org/vvo/forkie.png?branch=master)](https://travis-ci.org/vvo/forkie) [![Dependency Status](https://david-dm.org/vvo/forkie.png?theme=shields.io)](https://david-dm.org/vvo/forkie) [![devDependency Status](https://david-dm.org/vvo/forkie/dev-status.png?theme=shields.io)](https://david-dm.org/vvo/forkie#info=devDependencies)

Forkie is a graceful process manager which allows you to:
- register workers:
  - nodejs modules
  - node.js [cluster](http://nodejs.org/api/cluster.html#cluster_cluster_fork_env) workers
- register start/stop hooks on master and workers
- get workers events: ready/started/stopped
- get master events: worker ready, worker started, worker stopped, worker killed
- handle graceful stops (think long running jobs)
- automatically restart process
- provide a REPL with start/stop/restart for each process

Forkie solves the "how do we deal with graceful start an stops in our node.js application?".

See the [examples](examples/).

# master API

A forkie master will forks all the workers you give to him.
Workers must implement the [worker API](#worker-api).

```js
var workers = [
  'job-worker.js',
  'job-worker2.js',
  'job-worker2.js',
  require('cluster'),
  require('cluster')
];

// default options
var opts = {
  start: process.nextTick,  // executes before starting processes
  stop: process.nextTick,   // executes before stopping processes
  killTimeout: 5000         // how much `ms` to wait before killing a process that does not exits by itself
  restarts: false           // how many times should we restart a failed process, put `Infinity` or -1 for infinite restarts
  repl: false               // should we start a repl? See repl documentation
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

# REPL

Forkie can provide you a handy REPL to start/stop/restart workers individually.

You can use all the options from [dshaw/replify](https://github.com/dshaw/replify#options).

See the many usable clients on to [connect to the REPL](https://github.com/dshaw/replify#connect-to-the-repl).

Here's an example from [examples/master-repl.js](examples/master-repl.js) using
[dshaw/repl-client](https://github.com/dshaw/repl-client):

![example repl](http://dl.dropbox.com/u/3508235/Selection_152.png)

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

# forkie start workflow

All messages are sent with [IPC](http://nodejs.org/api/child_process.html#child_process_child_send_message_sendhandle)

- master calls user provided `start(cb)` function
- master forks every asked module (either filename or cluster.fork())
- workers sends a `{ graceful: { status: 'ready' } }` message, received by master
- master sends every fork a `{ graceful: { action: 'start' } }`, received by workers
- workers calls user provided `start(cb)` function
- workers sends a `{ graceful: { status: 'started' } }`, received by master
- master emits a `{ graceful: { status: 'started' } }` event

# forkie stop workflow

- master receives `SIGTERM`
- master calls user provided `stop(cb)` function
- master sends a `{ graceful: { action: 'stop' } }`, received by workers
- workers calls user provided `stop(cb)` function
- workers sends a `{ graceful: { status: 'stopped' } }`, received by master
- master emits a `{ graceful: { status: 'stopped' } }` event

If worker was working (i.e. `.working(true)` was called last), it will wait
for `.working(false)` to be called.

If worker did not gracefully exits before `killTimeout`, it will be [.kill('SIGKILL')](http://nodejs.org/api/child_process.html#child_process_child_kill_signal)ed.

If master does not exits by itself, it will stay online.

Master and worker exits are up to you, you must close all connections and timers for process
to exits gracefully.

# master failures

When master fails, all forked workers will automatically exit because they listen
to [disconnect](http://nodejs.org/api/child_process.html#child_process_event_disconnect) event.

# key differences with [isaacs/cluster-master](https://github.com/isaacs/cluster-master)

- no resize()
- provide a graceful stop API through [.working(true/false)](#.working(true/false)
- fully tested

# Graceful exit

Forkie will not call `process.exit()` for you.
All you workers must terminate their respective
connections and async loops in the `stop` method.

So that your process exits by itself.

When in a master-worker setup, your worker will be killed
after `killTimeout` ms if it doesn't exits.

When in a standalone worker setup, your worker will
not exits if you don't terminate your connections.
