var couchr = require('couchr'),
    async = require('async'),
    environment = require('../lib/environment'),
    config = require('../lib/config'),
    app = require('../lib/app'),
    path = require('path'),
    url = require('url'),
    utils = require('./lib/utils');


exports.setUp = function (callback) {
  var that = this;
  var project_dir = path.resolve(__dirname, 'fixtures/project1');
  var cfg = environment.getConfig(
    process.platform,   // platform
    process.env,        // environment vars
    project_dir,        // project directory
    []                  // command-line arguments
  );
  cfg.admin_password = 'testing';
  utils.resetFixture(project_dir, function (err) {
    app.init(cfg, function (err) {
      if (err) {
        return callback(err);
      }
      that.config = cfg;
      return callback();
    });
  });
};

exports.tearDown = function (callback) {
  app.stop(this.config, callback);
};

exports['app db unauthorized for non-admins'] = function (test) {
  var appdb = url.resolve(this.config.couch.url, '/app');
  couchr.get(appdb, function (err, data, res) {
    test.equal(res.statusCode, 401);
    test.done();
  });
};

exports['plugins db unauthorized for non-admins'] = function (test) {
  var appdb = url.resolve(this.config.couch.url, '/plugins');
  couchr.get(appdb, function (err, data, res) {
    test.equal(res.statusCode, 401);
    test.done();
  });
};

exports['app db authorized for admins'] = function (test) {
  var cfg = this.config;
  var appdb = url.resolve(cfg.couch.url, '/app');
  config.getCouchCredentials(cfg, function (err, username, password) {
    var parsed = url.parse(appdb);
    parsed.auth = username + ':' + password;
    appdb = url.format(parsed);
    couchr.get(appdb, function (err, data, res) {
      test.equal(res.statusCode, 200);
      test.done();
    });
  });
};

exports['plugins db authorized for admins'] = function (test) {
  var cfg = this.config;
  var appdb = url.resolve(cfg.couch.url, '/plugins');
  config.getCouchCredentials(cfg, function (err, username, password) {
    var parsed = url.parse(appdb);
    parsed.auth = username + ':' + password;
    appdb = url.format(parsed);
    couchr.get(appdb, function (err, data, res) {
      test.equal(res.statusCode, 200);
      test.done();
    });
  });
};
