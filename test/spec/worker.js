describe('creating a graceful process', function() {
  var EventEmitter = require('events').EventEmitter;
  var SandboxedModule = require('sandboxed-module');

  var fakeProcess;
  var graceful;
  var worker;

  beforeEach(function () {
    this.clock = sinon.useFakeTimers();
    fakeProcess = new EventEmitter();
    fakeProcess.version = 'gotohell-2.0';
    fakeProcess.nextTick = sinon.stub().yieldsAsync();

    worker = {
      start: sinon.stub().yields(),
      stop: sinon.stub().yields()
    };
  });

  afterEach(function () {
    this.clock.restore();
  });

  describe('when not started as a fork', function() {
    beforeEach(function (done) {
      var gracefulWorker = SandboxedModule.require(
        '../../lib/worker.js', {
          globals: {process: fakeProcess}
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
      expect(worker.start).to.be.called.once;
    });

    it('emits a started event', function() {
      expect(graceful.emit).to.be.calledWith('started');
    });

    describe('receiving a SIGTERM while busy', function () {
      beforeEach(function (done) {
        graceful.working(true);
        fakeProcess.once('SIGTERM', done);
        fakeProcess.emit('SIGTERM');
      });

      it('does not calls worker.stop', function() {
        expect(worker.stop).to.not.be.called;
      });

      it('does not emits a stopped event', function() {
        expect(graceful.emit).to.not.be.calledWith('stopped');
      });

      describe('when we are not busy anymore', function() {
        beforeEach(function () {
          graceful.working(false);
        });

        it('calls worker.stop', function() {
          expect(worker.stop).to.be.called.once;
          expect(worker.stop.getCall(0).args[0]).to.be.a.Function;
        });

        it('emits a stopped event', function() {
          expect(graceful.emit).to.be.calledWith('stopped');
        });
      });
    });

    describe('receiving a SIGTERM while not busy', function () {
      beforeEach(function (done) {
        fakeProcess.once('SIGTERM', done);
        fakeProcess.emit('SIGTERM');
      });

      it('calls worker.stop', function() {
        expect(worker.stop).to.be.called.once;
        expect(worker.stop.getCall(0).args[0]).to.be.a.Function;
      });
    });
  });

  describe('when started as a fork', function () {
    beforeEach(function (done) {
      fakeProcess.send = sinon.spy();
      fakeProcess.disconnect = sinon.spy();
      var gracefulWorker = SandboxedModule.require(
          '../../lib/worker.js', {
          globals: {process: fakeProcess}
        }
      );
      graceful = gracefulWorker('a forked worker', worker);
      sinon.spy(graceful, 'emit');
      process.nextTick(done);
    });

    it('emits a ready event', function() {
      expect(graceful.emit).to.be.calledWith('ready');
    });

    it('sends a ready message to master', function() {
      expect(fakeProcess.send).to.be.calledWith({
        graceful: {
          status: 'ready',
          title: 'a forked worker'
        }
      });
    });

    it('does not calls worker.start at first', function() {
      expect(worker.start).to.not.be.called;
    });

    describe('when receiving a SIGTERM', function () {
      beforeEach(function (done) {
        fakeProcess.once('SIGTERM', done);
        fakeProcess.emit('SIGTERM');
      });

      it('calls worker.stop', function() {
        expect(worker.stop).to.be.called.once;
      });

      it('emits a stoped event', function() {
        expect(graceful.emit).to.be.calledWith('stopped');
      });

      it('informs master through the communication channel', function() {
        expect(fakeProcess.send).to.be.calledWith({
          graceful: {
            status: 'stopped',
            title: 'a forked worker'
          }
        });
      });
    });

    describe('when master disconnects while stopping', function() {
      beforeEach(function (done) {
        sinon.stub(console, 'error');
        worker.stop = sinon.stub().yieldsAsync();
        fakeProcess.exit = sinon.spy();
        fakeProcess.emit('SIGTERM');
        process.nextTick(function() {
          fakeProcess.emit('disconnect')
        });
        process.nextTick(done);
      });

      it('forces process.exit', function(done) {
        process.nextTick(function() {
          expect(fakeProcess.exit).to.be.called.once;
          expect(fakeProcess.exit).to.be.calledWith(1);
          expect(console.error).to.be.calledWith('Master process died, forced exit of a forked worker');
          done();
        });
      });

      afterEach(function() {
        console.error.restore();
      });

    });

    describe('when master disconnects', function () {
      beforeEach(function () {
        fakeProcess.exit = sinon.spy();
        sinon.stub(console, 'error');
        fakeProcess.emit('disconnect');
      });

      it('forces process.exit', function(done) {
        process.nextTick(function() {
          expect(fakeProcess.exit).to.be.called.once;
          expect(fakeProcess.exit).to.be.calledWith(1);
          expect(console.error).to.be.calledWith('Master process died, forced exit of a forked worker');
          done();
        });
      });

      afterEach(function () {
        console.error.restore();
      });
    });

    describe('when master asks for start', function () {
      beforeEach(function () {
        fakeProcess.emit('message', {graceful: {action: 'start'}});
      });

      it('calls worker.start', function() {
        expect(worker.start).to.be.called.once;
      });

      it('emits a started event', function() {
        expect(graceful.emit).to.be.called.once;
        expect(graceful.emit).to.be.calledWith('started');
      });

      it('sends a started message to the master', function() {
        expect(fakeProcess.send).to.be.called.once;
        expect(fakeProcess.send).to.be.calledWith({
          graceful: {
            status: 'started',
            title: 'a forked worker'
          }
        });
      });

      it('make calls in the right order', function() {
        expect(worker.start).to.be.calledBefore(fakeProcess.send);
      });
    });
  });
});