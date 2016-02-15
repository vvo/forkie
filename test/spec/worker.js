'use strict';

var EventEmitter = require('events').EventEmitter;
var SandboxedModule = require('sandboxed-module');

describe('creating a graceful process', function() {
  var processMock;
  var graceful;
  var worker;

  beforeEach(function () {
    this.clock = sinon.useFakeTimers();

    processMock = new EventEmitter();
    processMock.version = 'gotohell-2.0';
    processMock.nextTick = sinon.stub().yieldsAsync();
    processMock.pid = 99999; // for logs

    worker = {
      start: sinon.stub().yields(),
      stop: sinon.stub().yields()
    };
  });

  afterEach(function () {
    this.clock.restore();
  });

  context('when not started as a fork', function() {
    beforeEach(function (done) {
      var gracefulWorker = SandboxedModule.require(
        '../../lib/worker.js', {
          globals: {process: processMock}
        }
      );
      graceful = gracefulWorker('a worker', worker);
      sinon.spy(graceful, 'emit');
      process.nextTick(done);
    });

    afterEach(function() {
      graceful.emit.restore();
    });

    it('calls worker.start', function() {
      expect(worker.start).to.have.been.called.once;
    });

    it('emits a started event', function() {
      expect(graceful.emit).to.have.been.calledWith('started');
    });

    context('on receiving a SIGTERM while busy', function () {
      beforeEach(function (done) {
        graceful.working(true);
        processMock.once('SIGTERM', done);
        processMock.emit('SIGTERM');
      });

      it('does not calls worker.stop', function() {
        expect(worker.stop).to.not.be.called;
      });

      it('does not emits a stopped event', function() {
        expect(graceful.emit).to.not.be.calledWith('stopped');
      });

      context('when we are not busy anymore', function() {
        beforeEach(function () {
          graceful.working(false);
        });

        it('calls worker.stop', function() {
          expect(worker.stop).to.have.been.called.once;
          expect(worker.stop.getCall(0).args[0]).to.be.a.Function;
        });

        it('emits a stopped event', function() {
          expect(graceful.emit).to.have.been.calledWith('stopped');
        });
      });
    });

    context('on receiving a SIGTERM while not busy', function () {
      beforeEach(function (done) {
        processMock.once('SIGTERM', done);
        processMock.emit('SIGTERM');
      });

      it('calls worker.stop', function() {
        expect(worker.stop).to.have.been.called.once;
        expect(worker.stop.getCall(0).args[0]).to.be.a.Function;
      });
    });
  });

  context('when started as a fork', function () {
    beforeEach(function (done) {
      processMock.send = sinon.spy();
      processMock.disconnect = sinon.spy();
      var gracefulWorker = SandboxedModule.require(
          '../../lib/worker.js', {
          globals: {process: processMock}
        }
      );
      graceful = gracefulWorker('a forked worker', worker);
      sinon.spy(graceful, 'emit');
      process.nextTick(done);
    });

    it('emits a ready event', function() {
      expect(graceful.emit).to.have.been.calledWith('ready');
    });

    it('sends a ready message to master', function() {
      expect(processMock.send).to.have.been.calledWith({
        graceful: {
          status: 'ready',
          title: 'a forked worker'
        }
      });
    });

    it('does not calls worker.start at first', function() {
      expect(worker.start).to.not.be.called;
    });

    context('when receiving a SIGTERM', function () {
      beforeEach(function (done) {
        processMock.once('SIGTERM', done);
        processMock.emit('SIGTERM');
      });

      it('calls worker.stop', function() {
        expect(worker.stop).to.have.been.called.once;
      });

      it('emits a stoped event', function() {
        expect(graceful.emit).to.have.been.calledWith('stopped');
      });

      it('informs master through the communication channel', function() {
        expect(processMock.send).to.have.been.calledWith({
          graceful: {
            status: 'stopped',
            title: 'a forked worker'
          }
        });
      });
    });

    context('when master disconnects while stopping', function() {
      beforeEach(function (done) {
        sinon.stub(console, 'error');
        worker.stop = sinon.stub().yieldsAsync();
        processMock.exit = sinon.spy();
        processMock.emit('SIGTERM');
        process.nextTick(function() {
          processMock.emit('disconnect')
        });
        process.nextTick(done);
      });

      it('forces process.exit', function(done) {
        process.nextTick(function() {
          expect(processMock.exit).to.have.been.called.once;
          expect(processMock.exit).to.have.been.calledWith(1);
          expect(console.error).to.have.been.calledWith('"%s"/%d Master process died, forced exit', 'a forked worker', 99999);
          done();
        });
      });

      afterEach(function() {
        console.error.restore();
      });

    });

    context('when master disconnects', function () {
      beforeEach(function () {
        processMock.exit = sinon.spy();
        sinon.stub(console, 'error');
        processMock.emit('disconnect');
      });

      it('forces process.exit', function(done) {
        process.nextTick(function() {
          expect(processMock.exit).to.have.been.called.once;
          expect(processMock.exit).to.have.been.calledWith(1);
          expect(console.error).to.have.been.calledWith('"%s"/%d Master process died, forced exit', 'a forked worker', 99999);
          done();
        });
      });

      afterEach(function () {
        console.error.restore();
      });
    });

    context('when master asks for start', function () {
      beforeEach(function () {
        processMock.emit('message', {graceful: {action: 'start'}});
      });

      it('calls worker.start', function() {
        expect(worker.start).to.have.been.called.once;
      });

      it('emits a started event', function() {
        expect(graceful.emit).to.have.been.called.once;
        expect(graceful.emit).to.have.been.calledWith('started');
      });

      it('sends a started message to the master', function() {
        expect(processMock.send).to.have.been.called.once;
        expect(processMock.send).to.have.been.calledWith({
          graceful: {
            status: 'started',
            title: 'a forked worker'
          }
        });
      });

      it('make calls in the right order', function() {
        expect(worker.start).to.have.been.calledBefore(processMock.send);
      });
    });
  });
});
