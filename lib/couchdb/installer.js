/**
 * Sets up CouchDB admin and Hoodie related dbs
 */

var request = require('request');
var path = require('path');
var crypto = require('crypto');
var async = require('async');
var prmpt = require('prompt');

var config = require('../core/config');

/**
 * Generates a password for the internal couch admin user
 * used by hoodie and associated plugins
 */

exports.generatePassword = function () {
  return crypto.randomBytes(256).toString('base64');
};

/**
 * Checks if CouchDB is in admin party mode
 */

exports.isAdminParty = function (cfg, callback) {
  request({
    url: cfg.couch.url + '/_users/_all_docs',
    method: 'HEAD'
  },
  function (err, res) {
    if (err) {
      return callback(err);
    }
    callback(null, res.statusCode === 200);
  });
};

/**
 * Checks if CouchDB is in admin party mode
 */

exports.checkCouchCredentials = function (cfg, callback) {
  config.getCouchCredentials(cfg, function (err, username, password) {
    if (err) {
      return callback(err);
    }

    if (!username || !password) {
      // missing from config, return a failure
      return callback(null, false);
    }

    request({
      url: cfg.couch.url + '/_users/_all_docs',
      method: 'HEAD',
      auth: {
        user: username,
        pass: password
      }
    },
    function (err, res) {
      if (err) {
        return callback(err);
      }
      callback(null, res.statusCode === 200);
    });
  });
};

/**
 * Polls CouchDB during startup so we know when we can make
 * requests against it
 */

exports.pollCouch = function (cfg, callback) {
  // when to stop polling and give up!
  var end = new Date().getTime() + 30000; // 30 second timeout
  var logfile = path.resolve(cfg.hoodie.app_path, 'couch.log');
  var interval = 200; // poll every 200ms

  process.stdout.write('Waiting for CouchDB..');

  function _poll() {
    request(cfg.couch.url, function (err, res) {
      if (res && res.statusCode === 200) {
        process.stdout.write(' done!\n');
        return callback();
      } else {
        // CouchDB not available yet
        if (new Date().getTime() >= end) {

          // Exceeded timeout value
          process.stdout.write('\n');

          return callback(new Error(
            'Timed out waiting for CouchDB, please check ' +
            logfile
          ));
        }
        // wait and try again
        process.stdout.write('.');
        return setTimeout(_poll, interval);
      }
    });
  }

  // start polling
  _poll();
};

/**
 * Sets the admin password on CouchDB to a newly generated password
 */

exports.createCouchCredentials = function (cfg, callback) {
  var username = '_hoodie';
  var password = exports.generatePassword();

  async.series([
    async.apply(request, {
      url: cfg.couch.url + '/_config/admins/' + username,
      method: 'PUT',
      body: JSON.stringify(password)
    }),
    async.apply(config.setCouchCredentials, cfg, username, password)
  ],
  callback);
};

/**
 * Creates plugin DB
 */

exports.setupPlugins = function (cfg, callback) {
  config.getCouchCredentials(cfg, function (err, username, password) {
    if (err) {
      return callback(err);
    }

    exports.createDB('plugins')(cfg, username, password, callback);
  });
};

/**
 * Create app DB and config doc
 */

exports.setupApp = function (cfg, callback) {
  config.getCouchCredentials(cfg, function (err, username, password) {
    if (err) {
      return callback(err);
    }
    async.applyEachSeries([
      exports.createDB('app'),
      exports.createAppConfig
    ],
    cfg, username, password, callback);
  });
};

/**
 * Returns a function which will create the named database
 */

exports.createDB = function (name) {
  return function (cfg, username, password, callback) {
    async.series([
      async.apply(request, {
        url: cfg.couch.url + '/' + encodeURIComponent(name),
        method: 'PUT',
        auth: {
          user: username,
          pass: password
        }
      }),
      async.apply(request, {
        url: cfg.couch.url + '/' + encodeURIComponent(name) + '/_security',
        method: 'PUT',
        auth: {
          user: username,
          pass: password
        },
        json: true,
        body: {
          admins: {roles: ['_admin']},
          members: {roles: ['_admin']}
        }
      }),
    ], callback);
  };
};

/**
 * Create appconfig doc in plugins database
 */

exports.createAppConfig = function (cfg, username, password, callback) {
  var body;

  try {
    body = JSON.stringify({
      _id : 'config',
      config : {},
      name: cfg.app.name,
      createdAt : new Date(),
      updatedAt : new Date()
    });
  } catch (e) {
    // catch json parse errors
    return callback(e);
  }

  request({
    url: cfg.couch.url + '/app/config',
    method: 'PUT',
    auth: {
      user: username,
      pass: password
    },
    body: body
  }, callback);
};

/**
 * Prompts the user to create a Hoodie admin account
 */

exports.promptAdminUser = function (callback) {
  if (process.env.CI) {
    // hardcode username as admin for now
    var result = {};
    result.name = 'admin';
    result.password = 'travis-ci';
    return callback(null, result);
  } else {
    prmpt.get({
      properties: {
        password: {
          description: 'Please set an admin password ',
          required: true,
          hidden: true
        }
      }
    },
    function (err, result) {
      // hardcode username as admin for now
      result.name = 'admin';
      return callback(err, result);
    });
  }
};

/**
 * Creates a Pocket admin user
 */

exports.saveAdminUser = function (cfg, couch_user, couch_pwd, user, callback) {
  request({
    url: cfg.couch.url + '/_config/admins/' + encodeURIComponent(user.name),
    method: 'PUT',
    body: JSON.stringify(user.password),
    json: true,
    auth: {
      user: couch_user,
      pass: couch_pwd
    }
  }, callback);
};

/**
 * Creates a CouchDB user with the appropriate roles to be an admin of
 * this Hoodie instance
 */

exports.createAdminUser = function (cfg, callback) {
  config.getCouchCredentials(cfg, function (err, username, password) {
    if (err) {
      return callback(err);
    }
    if (cfg.admin_password) {
      var user = {
        name: 'admin',
        password: cfg.admin_password
      };
      exports.saveAdminUser(cfg, username, password, user, callback);
    }
    else {
      exports.promptAdminUser(function (err, user) {
        if (err) {
          return callback(err);
        }
        exports.saveAdminUser(cfg, username, password, user, callback);
      });
    }
  });
};

/**
 * Ask the user for the CouchDB admin credentials
 */

exports.promptCouchCredentials = function (callback) {
  console.log('Please enter your CouchDB _admin credentials:');
  prmpt.get({
    properties: {
      name: {
        description: 'Username',
        required: true
      },
      password: {
        description: 'Password',
        required: true,
        hidden: true
      }
    }
  },
  function (err, result) {
    if (err) {
      return callback(err);
    }
    return callback(null, result.name, result.password);
  });
};

/**
 * Check that the stored couchdb credentials still work, prmpt the user
 * to update them if not.
 */

exports.updateCouchCredentials = function (cfg, callback) {
  exports.checkCouchCredentials(cfg, function (err, admin) {
    if (err) {
      return callback(err);
    }

    if (admin) {
      // stored admin user still works
      return callback();
    }

    // stored admin credentials out of date
    exports.promptCouchCredentials(function (err, user, pass) {
      if (err) {
        return callback(err);
      }

      config.setCouchCredentials(cfg, user, pass, function (err) {
        if (err) {
          return callback(err);
        }

        // make sure the new credentials work
        exports.updateCouchCredentials(cfg, callback);
      });
    });
  });
};


/**
 * Creates internal admin user and prmpts for Hoodie admin
 */

exports.setupUsers = function (cfg, callback) {
  exports.isAdminParty(cfg, function (err, party) {
    if (err) {
      return callback(err);
    }

    if (party) {
      async.applyEachSeries([
        exports.createCouchCredentials,
        exports.createAdminUser
      ],
      cfg, callback);
    } else {
      exports.updateCouchCredentials(cfg, callback);
    }
  });
};

/**
 * Checks CouchDB for required users/dbs, prmpts user for info
 * where appropriate
 */

exports.install = async.applyEachSeries([
  exports.setupUsers,
  exports.setupApp,
  exports.setupPlugins
]);
