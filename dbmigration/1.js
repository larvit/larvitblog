'use strict';

var log   = require('winston'),
    exec  = require('child_process').exec,
    path  = require('path'),
    async = require('async');

exports = module.exports = function(cb) {
	var tasks = [];

	// Load 1.sql
	tasks.push(function(cb) {
		var dbConf = require(path.dirname(require.main.filename) + '/config/db.json'),
		    cmd    = 'mysql -u ' + dbConf.user + ' -p' + dbConf.password;

		if (dbConf.host) {
			cmd += ' -h ' + dbConf.host;
		}

		cmd += ' ' + dbConf.database + ' < ' + __dirname + '/1.sql';

		exec(cmd, function(err, stdout, stderr) {
			var customErr;

			if (err) {
				cb(err);
				return;
			}

			if (stderr) {
				customErr = new Error('dbmigration/1.js: stderr is not empty: ' + stderr);
				cb(customErr);
				return;
			}

			log.info('larvitblog: dbmigration/1.js: Imported 1.sql');

			cb();
		});
	});

	async.series(tasks, cb);
};