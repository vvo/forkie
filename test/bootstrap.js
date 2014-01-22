// chai
var chai = require('chai');
chai.Assertion.includeStack = true;
chai.use(require('sinon-chai'));

// expose global test helpers
expect = chai.expect;
sinon = require('sinon');
