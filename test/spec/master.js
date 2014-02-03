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

    it('forked the provided modules', function() {
      expect(fakeCp.fork).to.be.calledTwice;
      expect(fakeCp.fork).to.be.calledWith('a-module.js');
      expect(fakeCp.fork).to.be.calledWith('another-module.js');
      expect(forks).to.length(2);
    });

    describe('when forks are ready', function () {

      beforeEach(function () {
        invoke(forks, 'emit', 'message', {
          graceful: {
            status: 'ready',
            title: 'omg'
          }
        });
      });

      it('set title on processes', function() {
        expect(forks[0].title).to.equal('omg');
        expect(forks[1].title).to.equal('omg');
      });

      it('emits ready event', function() {
        expect(workerEmit).to.be.calledWith('worker ready', {
          title: 'omg'
        });
      })

      it('asks for process start', function() {
        expect(send).to.be.calledTwice;
        expect(send).to.be.calledWith({
          graceful: {
            action: 'start'
          }
        });
      });

      describe('when fork has started', function () {
        beforeEach(function () {
          invoke(forks, 'emit', 'message', {
            graceful: {
              status: 'started',
              title: 'omg'
            }
          })
        });

        it('calls worker startCb', function() {
          expect(startCb).to.be.calledOnce;
        });

        it('emits a started event', function() {
          expect(workerEmit).to.be.calledWith('worker started', {
            title: 'omg'
          });
        })

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
              expect(send).to.be.calledWith({
                graceful: {
                  action: 'stop'
                }
              });
            });

            describe('when worker stops', function () {
              beforeEach(function () {
                invoke(forks, 'emit', 'exit', 0);
              });

              it('emits a worker stopped event', function() {
                expect(workerEmit).to.be.calledWith('worker stopped', {
                  code: 0,
                  title: 'omg'
                });
              });
            });

            describe('when worker does not stops fast enough', function () {
              beforeEach(function () {
                this.clock.tick(5 * 1000);
              });

              it('kills the worker with SIGKILL', function() {
                expect(kill).to.be.calledTwice;
                expect(kill).to.be.calledWith('SIGKILL');
              });

              describe('when worker stops', function () {
                beforeEach(function () {
                  invoke(forks, 'emit', 'exit', 1, 'SIGKILL');
                });

                it('emits a worker stopped event', function() {
                  expect(workerEmit).to.be.calledWith('worker stopped', {
                    code: 1,
                    signal: 'SIGKILL',
                    title: 'omg'
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

    it('called fork twice', function() {
      expect(fork).to.be.calledTwice;
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

    describe('when worker starts', function () {
      beforeEach(function () {
        invoke(forks, 'emit', 'message', {
          graceful: {
            status: 'started'
          }
        })
      });

      it('calls function in the right order', function() {
        expect(startCb).to.be.calledOnce;
        expect(startCb).to.be.calledAfter(fakeCp.fork);
      });
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

  // test events
  // test killTimeout
  // add integration testing master + standalone worker
});