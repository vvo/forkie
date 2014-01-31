forkie [![Build Status](https://travis-ci.org/vvo/forkie.png?branch=master)](https://travis-ci.org/vvo/forkie)
========

# STILL NOT READY, Readme Driven Development

Forkie is a graceful process manager which allows you to:
- register workers:
  - nodejs modules
  - node.js [cluster](http://nodejs.org/api/cluster.html#cluster_cluster_fork_env) workers
- register start/stop hooks on master and workers
- complete long asynchronous jobs before exiting
- restart workers

See the [examples](examples/).

# master API

```js
var master = require('forkie').master([
  'job-worker.js',
  'job-worker2.js',
  'job-worker2.js',
  require('cluster'),
  require('cluster')
], {
  // optionnal start hook,
  start: function(cb) {
    // call cb() when you are ready
    // forks will not be started before cb() is called
    setTimeout(cb, 3000);
  },
  // optionnal stop hook
  stop: function(cb) {
    // call cb() when you are ready
    // forks will not be stopped before cb() is called
    setTimeout(cb, 1500);
  },
  restarts: 5,
  killTimeout: 5000
})
```

# worker API

The worker API can be used in conjunction with a
master process (master-worker) or as a standalone worker.

```js
var worker =
  require('forkie')
  .worker('I am a process worker', {
    start: function(cb) {
      // connect to BDD etc
      // then call cb()
      setTimeout(cb, 3000);
    },
    // called when process receives SIGTERM (standalone worker)
    // or when master process receives SIGTERM (master-worker)
    stop: function(cb) {
      // disconnect from BDD etc
      // then call cb()
      setTimeout(cb, 10000);
    }
  });
```

## Job queue

When you have long running workers like a job queue,
you don't want to exit as soon as you are asked for.

You want to finish what you were doing.

Here is an hypothetic job worker doing just that:

```js
// hypothetic job queue
var jobs = require('jobs');

var worker =
  require('forkie')
  .worker('job worker', {
    start: function(cb) {
      jobs.on('new job', handleJob);
      jobs.on('end job', jobEnded);
      cb();
    },
    stop: function(cb) {
      // stop will be called as soon
      // we receives a stop order AND worker.working
      // is set to `false`
      jobs.removeListener('new job', handleJob);
      jobs.removeListener('end job', jobEnded);
      cb();
    }
  });

function handleJob(job, cb) {
  worker.working(true);

  // job processing takes 5s
  // here you could have multiple asynchronous calls
  // you don't want them to be interrupted by a SIGTERM
  setTimeout(cb, 5000);
}

function jobEnded(job) {
  // you must always indicate when you finish
  // a job, so that forkie knows when he could exits
  worker.working(false);
}
```

## Graceful exit

Forkie will not call `process.exit()` for you.
All you workers must terminate their respective
connections and async loops in the `stop` method.

So that your process exits by itself.

When in a master-worker setup, your worker will be killed
after `killTimeout` ms if it doesn't exits.

When in a standalone worker setup, your worker will
not exits if you don't terminate your connections.
