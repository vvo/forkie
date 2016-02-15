'use strict';

var EventEmitter = require('events').EventEmitter;
var SandboxedModule = require('sandboxed-module');
var invokemap = require('lodash.invokemap');

describe('creating a graceful master process', function () {
  var processMock;
  var workerMock;
  var childProcessMock;

  var gracefulMaster;
  var master;
  var forks;
  var send;
  var kill;
  var startCb;
  var stopCb;
  var workerEmit;

  beforeEach(function () {
    this.clock = sinon.useFakeTimers();
    workerEmit = sinon.spy();
    startCb = sinon.spy();
    stopCb = sinon.spy();
    send = sinon.spy();
    kill = sinon.spy();
    forks = [];
    processMock = new EventEmitter();
    processMock.nextTick = sinon.spy(function(cb) {
      cb();
    });

    // graceful worker minimal mock for master
    workerMock = sinon.spy(function(title, fns) {
      process.nextTick(fns.start.bind(null, startCb));
      processMock.on('SIGTERM', fns.stop.bind(null, stopCb));
      return {
        emit: workerEmit
      }
    });

    childProcessMock = {
      fork: sinon.spy(function(what) {
        var fork = new EventEmitter();
        fork.kill = kill;
        forks.push(fork);
        fork.send = send;
        fork.exitCode = null;
        return fork;
      })
    };

    gracefulMaster = SandboxedModule.require(
      '../../lib/master.js', {
        requires: {
          './worker.js': workerMock,
          'child_process': childProcessMock
        },
        globals: {
          process: processMock
        }
      }
    );
  });

  afterEach(function () {
    this.clock.restore();
  });

  context('with filenames to fork', function () {

    beforeEach(function(done) {
      master = gracefulMaster([
        'a-module.js',
        'another-module.js'
      ]);

      process.nextTick(done);
    });

    it('forks the first module', function() {
      expect(childProcessMock.fork).to.have.been.calledOnce;
      expect(childProcessMock.fork).to.have.been.calledWithExactly('a-module.js');
      expect(forks).to.length(1);
    });

    context('when fork is ready', function () {

      beforeEach(function () {
        forks[0].emit('message', {
          graceful: {
            status: 'ready',
            title: 'omg'
          }
        });
      });

      it('emits ready event', function() {
        expect(workerEmit).to.have.been.calledOnce;
        expect(workerEmit).to.have.been.calledWithMatch('worker ready', {
          id: 0,
          title: 'omg',
          toFork: 'a-module.js',
          restarts: {
            automatic: 0,
            manual: 0
          }
        });
      });

      it('asks for process start', function() {
        expect(send).to.have.been.calledOnce;
        expect(send).to.have.been.calledWithExactly({
          graceful: {
            action: 'start'
          }
        });
      });

      context('when fork starts', function () {
        beforeEach(function () {
          workerEmit.reset();
          forks[0].emit('message', {
            graceful: {
              status: 'started'
            }
          });
        });

        it('emits a started event', function() {
          expect(workerEmit).to.have.been.calledOnce;
          expect(workerEmit).to.have.been.calledWithMatch('worker started', {
            id: 0,
            toFork: 'a-module.js',
            restarts: {
              automatic: 0,
              manual: 0
            },
            title: 'omg'
          });
        });

        context('when second process is started', function() {
          beforeEach(function() {
            workerEmit.reset();

            forks[1].emit('message', {
              graceful: {
                status: 'ready',
                title: 'oh great'
              }
            });

            forks[1].emit('message', {
              graceful: {
                status: 'started'
              }
            });
          });

          it('starts second worker', function() {
            expect(workerEmit).to.have.been.calledTwice;
            expect(workerEmit).to.have.been.calledWithMatch('worker ready', {
              id: 1,
              toFork: 'another-module.js',
              restarts: {
                automatic: 0,
                manual: 0
              },
              title: 'oh great'
            });
            expect(workerEmit).to.have.been.calledWithMatch('worker started', {
              id: 1,
              toFork: 'another-module.js',
              restarts: {
                automatic: 0,
                manual: 0
              },
              title: 'oh great'
            });
          });

          it('calls startCb', function() {
            expect(startCb).to.have.been.calledOnce;
          });

          context('when forks are connected', function () {
            beforeEach(function () {
              forks.forEach(function(fork) {
                fork.connected = true;
              });
            });

            describe('and we receive a SIGTERM', function () {
              beforeEach(function () {
                send.reset();
                processMock.emit('SIGTERM');
              });

              it('gently ask the forks to stop', function() {
                expect(send).to.have.been.calledTwice;
                expect(send).to.have.been.calledWithExactly({
                  graceful: {
                    action: 'stop'
                  }
                });
              });

              context('when worker stops', function () {
                beforeEach(function () {
                  workerEmit.reset();
                  invokemap(forks, 'emit', 'exit', 0);
                });

                it('emits a worker stopped event', function() {
                  expect(workerEmit).to.have.been.calledTwice;
                  expect(workerEmit).to.have.been.calledWithMatch('worker stopped', {
                    title: 'omg'
                  });
                  expect(workerEmit).to.have.been.calledWithMatch('worker stopped', {
                    title: 'oh great'
                  });
                });

                it('calls stopCb', function() {
                  expect(stopCb).to.have.been.calledOnce;
                });
              });

              context('when worker does not stop fast enough', function () {
                beforeEach(function () {
                  this.clock.tick(5 * 1000);
                });

                it('kills the worker with SIGKILL', function() {
                  expect(kill).to.have.been.calledTwice;
                  expect(kill).to.have.been.calledWithExactly('SIGKILL');
                });

                describe('when worker finally stops', function () {
                  beforeEach(function () {
                    workerEmit.reset();
                    invokemap(forks, 'emit', 'exit', 1, 'SIGKILL');
                  });

                  it('emits a worker killed event', function() {
                    expect(workerEmit).to.have.been.calledTwice;
                    expect(workerEmit).to.have.been.calledWithMatch('worker killed', {
                      title: 'omg'
                    });
                    expect(workerEmit).to.have.been.calledWithMatch('worker killed', {
                      title: 'oh great'
                    });
                  });
                });
              });
            });
          });

          context('when forks are not connected', function () {
            context('and we receive a SIGTERM', function () {
              beforeEach(function () {
                processMock.emit('SIGTERM');
              });

              it('calls fork.kill', function() {
                expect(kill).to.have.been.calledTwice;
              });
            });
          });

          context('when fork failed', function () {
            beforeEach(function() {
              forks[0].exitCode = 8;
            });

            context('and we receive a SIGTERM', function () {
              beforeEach(function () {
                processMock.emit('SIGTERM');
                forks[1].emit('exit', 0);
              });

              it('reaches stopCb', function() {
                expect(stopCb).to.have.been.calledOnce;
              });
            });
          });

          context('when cluster fork failed', function () {
            beforeEach(function() {
              forks[0].process = { exitCode: 8 };
            });

            context('and we receive a SIGTERM', function () {
              beforeEach(function () {
                processMock.emit('SIGTERM');
                forks[1].emit('exit', 0);
              });

              it('reaches stopCb', function() {
                expect(stopCb).to.have.been.calledOnce;
              });
            });
          });
        });
      });
    });
  });

  context('with cluster workers to fork', function () {
    var fork = sinon.stub().returns(new EventEmitter);

    beforeEach(function(done) {
      master = gracefulMaster([
        {fork: fork},
        {fork: fork}
      ]);

      process.nextTick(done);
    });

    // forks are made in series not in parallel
    it('called fork once', function() {
      expect(fork).to.have.been.calledOnce;
    })
  });

  context('when using a specific start function', function () {
    var start = sinon.stub().yields();

    beforeEach(function(done) {
      master = gracefulMaster([
        'a-module.js'
      ], {
        start: start
      });

      process.nextTick(done);
    });

    it('calls functions in the right order', function() {
      expect(childProcessMock.fork).to.have.been.calledOnce;
      expect(start).to.have.been.calledOnce;
      expect(start).to.have.been.calledBefore(childProcessMock.fork);
    });
  });

  context('when using a specific stop function', function () {
    var stop = sinon.stub().yields();

    beforeEach(function(done) {
      stop.reset();

      master = gracefulMaster([
        'a-module.js'
      ], {
        stop: stop
      });

      process.nextTick(done);
    });

    context('when worker is not connected', function () {
      beforeEach(function () {
        processMock.emit('SIGTERM');
      });

      it('calls function in the right order', function() {
        expect(stop).to.have.been.calledOnce;
        expect(kill).to.have.been.calledOnce;
        expect(stop).to.have.been.calledBefore(kill);
      });
    });

    context('when worker is connected', function () {
      beforeEach(function () {
        forks[0].connected = true;
        processMock.emit('SIGTERM');
      });

      it('calls function in the right order', function() {
        expect(stop).to.have.been.calledOnce;
        expect(send).to.have.been.calledOnce;
        expect(stop).to.have.been.calledBefore(send);
      });
    });
  });

  describe('when using automatic restart', function() {
    beforeEach(function() {
      master = gracefulMaster([
        'a-restarted-module.js'
      ], {
        restarts: 1
      });
    });

    describe('and worker as started gracefully', function() {
      beforeEach(function(done) {
        process.nextTick(function() {
          forks[0].emit('message', {
            graceful: {
              status: 'ready',
              title: 'yeepee'
            }
          });

          forks[0].emit('message', {
            graceful: {
              status: 'started'
            }
          });

          done();
        });
      });

      describe('when fork exits with 1', function(done) {
        beforeEach(function () {
          forks[0].emit('exit', 1);
          // restart timeout
          this.clock.tick(1000);
        });

        it('calls fork again', function() {
          // two times: init and restart
          expect(childProcessMock.fork).to.have.been.calledTwice;
          expect(childProcessMock.fork).to.have.been.calledWithExactly('a-restarted-module.js');
        });

        it('sends a restarted event', function() {
          expect(workerEmit).to.have.been.calledWithMatch('worker restarted', {
            restarts: { manual: 0, automatic: 1 }
          });
        });
      });

      describe('when fork exits with 1 and a signal was sent', function(done) {
        beforeEach(function () {
          forks[0].emit('exit', 1, 'SIGKILL');
          // restart timeout
          this.clock.tick(1000);
        });

        it('do not call fork again', function() {
          expect(childProcessMock.fork).to.have.been.calledOnce;
        });

        it('does not sends a restarted event', function() {
          expect(workerEmit).to.not.be.calledWithExactly('worker restarted', {
            id: 0,
            toFork: 'a-restarted-module.js',
            restarts: { manual: 0, automatic: 1 }
          });
        });
      });

      describe('when fork exits with 0', function(done) {
        beforeEach(function () {
          forks[0].emit('exit', 0);
        });

        it('does not call fork again', function() {
          expect(childProcessMock.fork).to.have.been.calledOnce;
        });

        it('does not sends a restarted event', function() {
          expect(workerEmit).to.not.be.calledWithExactly('worker restarted', {
            id: 0,
            toFork: 'a-restarted-module.js',
            restarts: { manual: 0, automatic: 1 }
          });
        });
      });
    });

    describe('and worker did not yet start', function() {
      describe('when fork exits with 1', function() {
        beforeEach(function () {
          forks[0].emit('exit', 1);
          // restart timeout
          this.clock.tick(1000);
        });

        it('calls fork again', function() {
          // two times: init and restart
          expect(childProcessMock.fork).to.have.been.calledTwice;
          expect(childProcessMock.fork).to.have.been.calledWithExactly('a-restarted-module.js');
        });

        it('sends a restarted event', function() {
          expect(workerEmit).to.have.been.calledWithMatch('worker restarted', {
            restarts: { manual: 0, automatic: 1 }
          });
        });
      });
    });
  });
});
