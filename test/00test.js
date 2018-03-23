'use strict';

const	Intercom	= require('larvitamintercom'),
	slugify	= require('larvitslugify'),
	uuidLib	= require('uuid'),
	moment	= require('moment'),
	assert	= require('assert'),
	async	= require('async'),
	log	= require('winston'),
	db	= require('larvitdb'),
	fs	= require('fs');

let	entryUuid	= uuidLib.v1(),
	entryUuid2	= uuidLib.v1(),
	blogLib;

// Set up winsston
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

		for (const args of process.argv) {
			if (args.startsWith('-confFile=')){
				confFile = args.split('=')[1];
			}
		}

		if ( ! confFile) confFile = __dirname + '/../config/db_test.json';

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

	// Load lib
	tasks.push(function (cb) {
		blogLib	= require(__dirname + '/../blog.js');
		blogLib.dataWriter.mode	= 'master';
		blogLib.dataWriter.intercom	= new Intercom('loopback interface');
		cb();
	});

	tasks.push(function (cb) {
		blogLib.dataWriter.ready(cb);
	});

	async.series(tasks, done);
});

after(function (done) {
	db.removeAllTables(done);
});

describe('Sanity test', function () {
	it('Get entries of empty database', function (done) {
		blogLib.getEntries({}, function (err, entries) {
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
			blogLib.saveEntry(entry, cb);
		});

		tasks.push(function (cb) {
			blogLib.getEntries({'uuids': entry.uuid}, function (err, entries) {
				assert.strictEqual(err === null, true);
				assert.strictEqual(entries.length, 1);
				cb();
			});
		});

		async.series(tasks, done);
	});

	it('Create a second post', function (done) {
		const tasks	= [],
			entry = {
				'langs'	: {
					'en' : {
						'slug'	: moment().format('YYYY-MM-DD_') + slugify('One bottle of beer on the wall', '-'),
						'tags'	: 'Beer,Bacon,Moar beer',
						'header'	: 'Its all about the beer',
						'summary'	: 'All hail the lord of beer!',
						'body'	: 'I love beer, everybody loves beer.'
					}
				},
				'published'	: moment().toDate(),
				'uuid'	: entryUuid2
			};

		tasks.push(function (cb) {
			blogLib.saveEntry(entry, cb);
		});

		tasks.push(function (cb) {
			blogLib.getEntries({'uuids': entry.uuid}, function (err, entries) {
				assert.strictEqual(err === null, true);
				assert.strictEqual(entries.length, 1);
				cb();
			});
		});

		async.series(tasks, done);
	});

	it('Edit blog post', function (done) {
		const tasks	= [],
			entry = {
				'langs'	: {
					'en' : {
						'slug'	: moment().format('YYYY-MM-DD_') + slugify('Bacon, oh, sweet bacon', '-'),
						'tags'	: 'Updated tags, bags',
						'header'	: 'The second comming of the lord of bacon',
						'summary'	: 'All hail the lord of bacon!',
						'body'	: 'I love bacon, everybody loves bacon.'
					}
				},
				'published'	: moment().toDate(),
				'uuid'	: entryUuid
			};

		tasks.push(function (cb) {
			blogLib.saveEntry(entry, cb);
		});

		tasks.push(function (cb) {
			blogLib.getEntries({'uuids': entry.uuid}, function (err, entries) {
				assert.strictEqual(err === null, true);
				assert.strictEqual(entries.length, 1);
				cb();
			});
		});

		async.series(tasks, done);
	});
});

describe('Search', function () {
	it('do the full text search', function (done) {
		blogLib.search('beer', function (err, uuids) {
			if (err) throw err;
			assert.strictEqual(uuids.length, 1);

			blogLib.getEntries({'uuids': uuids}, function (err, entries) {
				assert.strictEqual(entries[0].langs.en.header, 'Its all about the beer');
				done();
			});
		});
	});
});

describe('Get entries', function () {
	it('Get some old entries', function (done) {
		blogLib.getEntries(function (err, entries) {
			assert.strictEqual(err === null, true);
			assert.strictEqual(entries.length, 2);

			for (const e of entries) {
				assert.strictEqual(e.uuid === entryUuid || e.uuid === entryUuid2, true);
				assert.notStrictEqual(e.langs.en.tags, undefined);
				assert.notStrictEqual(e.langs.en.summary, undefined);
			}

			done();
		});
	});
});

describe('Add images to entry', function () {
	it('Add new image to entry', function (done) {
		const tasks = [];

		tasks.push(function (cb) {
			blogLib.getEntries({'uuids': entryUuid}, function (err, entries) {
				assert.strictEqual(err, null);
				assert.strictEqual(entries.length, 1);
				assert.strictEqual(entries[0].images, null);
				cb();
			});
		});

		tasks.push(function (cb) {
			blogLib.setImages({'uuid': entryUuid, 'images': [{'number': 1, 'uri': '/some/image/file.png'}]}, cb);
		});

		tasks.push(function (cb) {
			blogLib.getEntries({'uuids': entryUuid}, function (err, entries) {
				assert.strictEqual(err, null);
				assert.strictEqual(entries.length, 1);
				assert.strictEqual(entries[0].images, '/some/image/file.png');
				cb();
			});
		});

		async.series(tasks, done);
	});

	it('Add an additional image', function (done) {

		const tasks	= [];

		let image = null;

		tasks.push(function (cb) {
			blogLib.getEntries({'uuids': entryUuid}, function (err, entries) {
				assert.strictEqual(err, null);
				assert.strictEqual(entries.length, 1);
				assert.notStrictEqual(entries[0].images, null);
				image = entries[0].images;
				cb();
			});
		});

		tasks.push(function (cb) {
			blogLib.setImages({'uuid': entryUuid, 'images': [{'number': 1, 'uri': image}, {'number': 2, 'uri': '/some/other/uri.jpeg'}]}, cb);
		});

		tasks.push(function (cb) {
			blogLib.getEntries({'uuids': entryUuid}, function (err, entries) {
				assert.strictEqual(err, null);
				assert.strictEqual(entries.length, 1);
				assert.notStrictEqual(entries[0].images, undefined);
				assert.strictEqual(entries[0].images.split(',').length, 2);
				cb();
			});
		});

		async.series(tasks, done);
	});

	it('Remove all images from entry', function (done) {
		const tasks = [];

		tasks.push(function (cb) {
			blogLib.setImages({'uuid': entryUuid}, cb);
		});

		tasks.push(function (cb) {
			blogLib.getEntries({'uuids': entryUuid}, function (err, entries) {
				assert.strictEqual(err, null);
				assert.strictEqual(entries.length, 1);
				assert.strictEqual(entries[0].images, null);
				cb();
			});
		});

		async.series(tasks, done);
	});
});

describe('Remove entry', function () {
	it('Take er out behind the barn and shoot er', function (done) {
		const tasks = [];

		tasks.push(function (cb) {
			blogLib.rmEntry(entryUuid, cb);
		});

		tasks.push(function (cb) {
			blogLib.getEntries({'uuid': entryUuid}, function (err, entries) {
				assert.strictEqual(err === null, true);
				assert.strictEqual(entries.length, 1);
				assert.strictEqual(entries[0].uuid, entryUuid2);
				cb();
			});
		});

		async.series(tasks, done);
	});
});
