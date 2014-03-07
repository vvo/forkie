describe('creating a graceful master process', function () {
  var EventEmitter = require('events').EventEmitter;
  var SandboxedModule = require('sandboxed-module');
  var invoke= require('lodash.invoke');

  var fakeProcess;
  var fakeWorker;
  var fakeCp;
  var gracefulMaster;
  var master;
  var forks;
  var send;
  var kill;
  var startCb;
  var stopCb;

  beforeEach(function () {
    this.clock = sinon.useFakeTimers();
    workerEmit = sinon.spy();
    startCb = sinon.spy();
    stopCb = sinon.spy();
    send = sinon.spy();
    kill = sinon.spy();
    forks = [];
    fakeProcess = new EventEmitter();
    fakeProcess.nextTick = sinon.spy(function(cb) {
      cb();
    });

    // graceful worker minimal mock for master
    fakeWorker = sinon.spy(function(title, fns) {
      process.nextTick(fns.start.bind(null, startCb));
      fakeProcess.on('SIGTERM', fns.stop.bind(null, stopCb));
      return {
        emit: workerEmit
      }
    });

    fakeCp = {
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
          './worker.js': fakeWorker,
          'child_process': fakeCp
        },
        globals: {
          process: fakeProcess
        }
      }
    );
  });

  afterEach(function () {
    this.clock.restore();
  });

  describe('with filenames to fork', function () {

    beforeEach(function(done) {
      master = gracefulMaster([
        'a-module.js',
        'another-module.js'
      ]);

      process.nextTick(done);
    });

    it('forked the first module', function() {
      expect(fakeCp.fork).to.be.calledOnce;
      expect(fakeCp.fork).to.be.calledWithExactly('a-module.js');
      expect(forks).to.length(1);
    });

    describe('when fork is ready', function () {

      beforeEach(function () {
        forks[0].emit('message', {
          graceful: {
            status: 'ready',
            title: 'omg'
          }
        });
      });

      it('emits ready event', function() {
        expect(workerEmit).to.be.calledOnce;
        expect(workerEmit).to.be.calledWithMatch('worker ready', {
          id: 0,
          title: 'omg',
          toFork: 'a-module.js',
          restarts: {
            automatic: 0,
            manual: 0
          }
        });
      })

      it('asks for process start', function() {
        expect(send).to.be.calledOnce;
        expect(send).to.be.calledWithExactly({
          graceful: {
            action: 'start'
          }
        });
      });

      describe('when fork starts', function () {
        beforeEach(function () {
          workerEmit.reset();
          forks[0].emit('message', {
            graceful: {
              status: 'started'
            }
          });
        });

        it('emits a started event', function() {
          expect(workerEmit).to.be.calledOnce;
          expect(workerEmit).to.be.calledWithMatch('worker started', {
            id: 0,
            toFork: 'a-module.js',
            restarts: {
              automatic: 0,
              manual: 0
            },
            title: 'omg'
          });
        });

        describe('when second process is started', function() {
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
            expect(workerEmit).to.be.calledTwice;
            expect(workerEmit).to.be.calledWithMatch('worker ready', {
              id: 1,
              toFork: 'another-module.js',
              restarts: {
                automatic: 0,
                manual: 0
              },
              title: 'oh great'
            });
            expect(workerEmit).to.be.calledWithMatch('worker started', {
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
            expect(startCb).to.be.calledOnce;
          });

          describe('when forks are connected', function () {
            beforeEach(function () {
              forks.forEach(function(fork) {
                fork.connected = true;
              });
            });

            describe('and we receive a SIGTERM', function () {
              beforeEach(function () {
                send.reset();
                fakeProcess.emit('SIGTERM');
              });

              it('gently ask the forks to stop', function() {
                expect(send).to.be.calledTwice;
                expect(send).to.be.calledWithExactly({
                  graceful: {
                    action: 'stop'
                  }
                });
              });

              describe('when worker stops', function () {
                beforeEach(function () {
                  workerEmit.reset();
                  invoke(forks, 'emit', 'exit', 0);
                });

                it('emits a worker stopped event', function() {
                  expect(workerEmit).to.be.calledTwice;
                  expect(workerEmit).to.be.calledWithMatch('worker stopped', {
                    title: 'omg'
                  });
                  expect(workerEmit).to.be.calledWithMatch('worker stopped', {
                    title: 'oh great'
                  });
                });

                it('calls stopCb', function() {
                  expect(stopCb).to.be.calledOnce;
                });
              });

              describe('when worker does not stops fast enough', function () {
                beforeEach(function () {
                  this.clock.tick(5 * 1000);
                });

                it('kills the worker with SIGKILL', function() {
                  expect(kill).to.be.calledTwice;
                  expect(kill).to.be.calledWithExactly('SIGKILL');
                });

                describe('when worker finally stops', function () {
                  beforeEach(function () {
                    workerEmit.reset();
                    invoke(forks, 'emit', 'exit', 1, 'SIGKILL');
                  });

                  it('emits a worker killed event', function() {
                    expect(workerEmit).to.be.calledTwice;
                    expect(workerEmit).to.be.calledWithMatch('worker killed', {
                      title: 'omg'
                    });
                    expect(workerEmit).to.be.calledWithMatch('worker killed', {
                      title: 'oh great'
                    });
                  });
                });
              });
            });
          });

          describe('when forks are not connected', function () {
            describe('and we receive a SIGTERM', function () {
              beforeEach(function () {
                fakeProcess.emit('SIGTERM');
              });

              it('calls fork.kill', function() {
                expect(kill).to.be.calledTwice;
              });
            });
          });

          describe('when fork failed', function () {
            beforeEach(function() {
              forks[0].exitCode = 8;
            });

            describe('and we receive a SIGTERM', function () {
              beforeEach(function () {
                fakeProcess.emit('SIGTERM');
                forks[1].emit('exit', 0);
              });

              it('reaches stopCb', function() {
                expect(stopCb).to.be.calledOnce;
              });
            });
          });

          describe('when cluster fork failed', function () {
            beforeEach(function() {
              forks[0].process = { exitCode: 8 };
            });

            describe('and we receive a SIGTERM', function () {
              beforeEach(function () {
                fakeProcess.emit('SIGTERM');
                forks[1].emit('exit', 0);
              });

              it('reaches stopCb', function() {
                expect(stopCb).to.be.calledOnce;
              });
            });
          });

        });
      });
    });
  });

  describe('with cluster workers to fork', function () {
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
      expect(fork).to.be.calledOnce;
    })
  });

  describe('when using a specific start function', function () {
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
      expect(fakeCp.fork).to.be.calledOnce;
      expect(start).to.be.calledOnce;
      expect(start).to.be.calledBefore(fakeCp.fork);
    });
  });

  describe('when using a specific stop function', function () {
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

    describe('when worker is not connected', function () {
      beforeEach(function () {
        fakeProcess.emit('SIGTERM');
      });

      it('calls function in the right order', function() {
        expect(stop).to.be.calledOnce;
        expect(kill).to.be.calledOnce;
        expect(stop).to.be.calledBefore(kill);
      });
    });

    describe('when worker is connected', function () {
      beforeEach(function () {
        forks[0].connected = true;
        fakeProcess.emit('SIGTERM');
      });

      it('calls function in the right order', function() {
        expect(stop).to.be.calledOnce;
        expect(send).to.be.calledOnce;
        expect(stop).to.be.calledBefore(send);
      });
    });
  });

  describe('when using automatic restart', function() {
    beforeEach(function(done) {
      master = gracefulMaster([
        'a-restarted-module.js'
      ], {
        restarts: 1
      });

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
        expect(fakeCp.fork).to.be.calledTwice;
        expect(fakeCp.fork).to.be.calledWithExactly('a-restarted-module.js');
      });

      it('sends a restarted event', function() {
        expect(workerEmit).to.be.calledWithMatch('worker restarted', {
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
        expect(fakeCp.fork).to.be.calledOnce;
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
        expect(fakeCp.fork).to.be.calledOnce;
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
});