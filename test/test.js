'use strict';

const	Intercom	= require('larvitamintercom'),
	blog	= require(__dirname + '/../blog.js'),
	assert	= require('assert'),
	lUtils	= require('larvitutils'),
	async	= require('async'),
	log	= require('winston'),
	db	= require('larvitdb'),
	fs	= require('fs'),
	moment	= require('moment'),
	slugify	= require('slugify'),
	uuidLib	= require('uuid');

let entryUuid = uuidLib.v1();

blog.dataWriter	= require(__dirname + '/../dataWriter.js');
blog.dataWriter.mode = 'master';

// Set up winston
log.remove(log.transports.Console);
/**/log.add(log.transports.Console, {
	'level':	'warn',
	'colorize':	true,
	'timestamp':	true,
	'json':	false
});/**/

before(function (done) {
	this.timeout(10000);
	const	tasks	= [];

	// Run DB Setup
	tasks.push(function (cb) {
		let confFile;

		if (process.env.DBCONFFILE === undefined) {
			confFile = __dirname + '/../config/db_test.json';
		} else {
			confFile = process.env.DBCONFFILE;
		}

		log.verbose('DB config file: "' + confFile + '"');

		// First look for absolute path
		fs.stat(confFile, function (err) {
			if (err) {

				// Then look for this string in the config folder
				confFile = __dirname + '/../config/' + confFile;
				fs.stat(confFile, function (err) {
					if (err) throw err;
					log.verbose('DB config: ' + JSON.stringify(require(confFile)));
					db.setup(require(confFile), cb);
				});

				return;
			}

			log.verbose('DB config: ' + JSON.stringify(require(confFile)));
			db.setup(require(confFile), cb);
		});
	});

	// Check for empty db
	tasks.push(function (cb) {
		db.query('SHOW TABLES', function (err, rows) {
			if (err) throw err;

			if (rows.length) {
				throw new Error('Database is not empty. To make a test, you must supply an empty database!');
			}

			cb();
		});
	});

	// Setup intercom
	tasks.push(function (cb) {
		let confFile;

		if (process.env.INTCONFFILE === undefined) {
			confFile = __dirname + '/../config/amqp_test.json';
		} else {
			confFile = process.env.INTCONFFILE;
		}

		log.verbose('Intercom config file: "' + confFile + '"');

		// First look for absolute path
		fs.stat(confFile, function (err) {
			if (err) {

				// Then look for this string in the config folder
				confFile = __dirname + '/../config/' + confFile;
				fs.stat(confFile, function (err) {
					if (err) throw err;
					log.verbose('Intercom config: ' + JSON.stringify(require(confFile)));
					lUtils.instances.intercom = new Intercom(require(confFile).default);
					lUtils.instances.intercom.on('ready', cb);
				});

				return;
			}

			log.verbose('Intercom config: ' + JSON.stringify(require(confFile)));
			lUtils.instances.intercom = new Intercom(require(confFile).default);
			lUtils.instances.intercom.on('ready', cb);
		});
	});

	tasks.push(function (cb) {
		blog.dataWriter.ready(cb);
	});

	async.series(tasks, done);
});

after(function (done) {
	db.removeAllTables(done);
});

describe('Sanity test', function () {
	it('Get entries of empty database', function (done) {
		blog.getEntries({}, function (err, entries) {
			assert.strictEqual(err === null, true);
			assert.deepEqual(entries, []);
			done();
		});
	});
});

describe('Create blog post', function () {
	it('Some regular blog postin\'', function (done) {
		const tasks	= [],
			entry = {
				'langs'	: {
					'en' : {
						'slug'	: moment().format('YYYY-MM-DD_') + slugify('Bacon, oh, sweet bacon', '-'),
						'tags'	: 'Taaags, Baags, Bag ladies, Bacon',
						'header'	: 'The second comming of the lord of bacon',
						'summary'	: 'All hail the lord of bacon!',
						'body'	: 'I love bacon, everybody loves bacon.'
					}
				},
				'published'	: moment().toDate(),
				'uuid'	: entryUuid
			};

		tasks.push(function (cb) {
			blog.saveEntry(entry, cb);
		});

		tasks.push(function (cb) {
			blog.getEntries({'uuid': entry.uuid}, function (err, entries) {
				assert.strictEqual(err === null, true);
				assert.strictEqual(entries.length, 1);
				cb();
			});
		});

		async.series(tasks, done);
	});
});

describe('Get entries', function () {
	it('Get some ole entries', function (done) {
		blog.getEntries({'uuid': entryUuid}, function (err, entries) {
			assert.strictEqual(err === null, true);
			assert.strictEqual(entries.length, 1);
			assert.strictEqual(entries[0].uuid, entryUuid);
			assert.strictEqual(entries[0].langs.en.tags.split(',').length, 4);
			assert.strictEqual(entries[0].langs.en.summary, 'All hail the lord of bacon!');
			done();
		});
	});
});

describe('Remove entry', function () {
	it('Take er out behind the barn and shoot er', function (done) {
		const tasks = [];

		tasks.push(function (cb) {
			blog.rmEntry(entryUuid, cb);
		});

		tasks.push(function (cb) {
			blog.getEntries({'uuid': entryUuid}, function (err, entries) {
				assert.strictEqual(err === null, true);
				assert.strictEqual(entries.length, 0);
				cb();
			});
		});

		async.series(tasks, done);
	});
});