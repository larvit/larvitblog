'use strict';

const Intercom = require('larvitamintercom');
const Blog = require(__dirname + '/../blog.js');
const LUtils = require('larvitutils');
const lUtils = new LUtils();
const slugify = require('larvitslugify');
const uuidLib = require('uuid');
const moment = require('moment');
const assert = require('assert');
const async = require('async');
const log = new lUtils.Log('warn');
const db = require('larvitdb');

let entryUuid = uuidLib.v1();
let entryUuid2 = uuidLib.v1();
let entryUuid3 = uuidLib.v1();
let blogLib;

before(function (done) {
	this.timeout(10000);
	const tasks = [];

	// Run DB Setup
	tasks.push(function (cb) {
		let confFile;

		if (process.env.TRAVIS) {
			confFile = __dirname + '/../config/db_travis.json';
		} else {
			confFile = __dirname + '/../config/db_test.json';
		}

		log.verbose('DB config file: "' + confFile + '", with contents: ' + JSON.stringify(require(confFile)));
		db.setup(require(confFile), cb);
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
		blogLib = new Blog({
			mode: 'noSync',
			intercom: new Intercom('loopback interface'),
			db,
			log,
			lUtils
		}, cb);
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
		const tasks = [];


		const entry = {
			langs: {
				en: {
					slug: moment().format('YYYY-MM-DD_') + slugify('Bacon, oh, sweet bacon', '-'),
					tags: 'Taaags,Baags,Bag ladies,Bacon',
					header: 'The second comming of the lord of bacon',
					summary: 'All hail the lord of bacon!',
					body: 'I love bacon, everybody loves bacon.'
				}
			},
			published: moment().subtract(1, 'hours')
				.toDate(), // I HATE TIMEZONES
			uuid: entryUuid
		};

		tasks.push(function (cb) {
			blogLib.saveEntry(entry, cb);
		});

		tasks.push(function (cb) {
			blogLib.getEntries({uuids: entry.uuid}, function (err, entries) {
				assert.strictEqual(err === null, true);
				assert.strictEqual(entries.length, 1);
				assert.strictEqual(entries[0].langs.en.slug, entry.langs.en.slug);
				assert.strictEqual(entries[0].langs.en.tags, entry.langs.en.tags);
				assert.strictEqual(entries[0].langs.en.header, entry.langs.en.header);
				assert.strictEqual(entries[0].langs.en.summary, entry.langs.en.summary);
				assert.strictEqual(entries[0].langs.en.body, entry.langs.en.body);
				cb();
			});
		});

		async.series(tasks, done);
	});

	it('Create a second post', function (done) {
		const tasks = [];


		const entry = {
			langs: {
				en: {
					slug: moment().format('YYYY-MM-DD_') + slugify('One bottle of beer on the wall', '-'),
					tags: 'Beer,Bacon,Moar beer',
					header: 'Its all about the beer',
					summary: 'All hail the lord of beer!',
					body: 'I love beer, everybody loves beer.'
				}
			},
			published: moment().subtract(1, 'hours')
				.toDate(), // Fucking timezones
			uuid: entryUuid2
		};

		tasks.push(function (cb) {
			blogLib.saveEntry(entry, cb);
		});

		tasks.push(function (cb) {
			blogLib.getEntries({uuids: entry.uuid}, function (err, entries) {
				assert.strictEqual(err === null, true);
				assert.strictEqual(entries.length, 1);
				assert.strictEqual(entries[0].langs.en.slug, entry.langs.en.slug);
				assert.strictEqual(entries[0].langs.en.tags, entry.langs.en.tags);
				assert.strictEqual(entries[0].langs.en.header, entry.langs.en.header);
				assert.strictEqual(entries[0].langs.en.summary, entry.langs.en.summary);
				assert.strictEqual(entries[0].langs.en.body, entry.langs.en.body);
				cb();
			});
		});

		async.series(tasks, done);
	});

	it('Update previous post', function (done) {
		const tasks = [];


		const entry = {
			langs: {
				en: {
					slug: moment().format('YYYY-MM-DD_') + slugify('One bottle of beer on the floor', '-'),
					tags: 'Beer,Bacon,Moar beer,Ham',
					header: 'Its all about the beer',
					summary: 'All hail the lord of beer!',
					body: 'I love beer, but not everybody loves beer.'
				}
			},
			published: moment().subtract(3, 'hours')
				.toDate(), // Fucking timezones
			uuid: entryUuid2
		};

		tasks.push(function (cb) {
			blogLib.saveEntry(entry, cb);
		});

		tasks.push(function (cb) {
			blogLib.getEntries({uuids: entry.uuid}, function (err, entries) {
				assert.strictEqual(err === null, true);
				assert.strictEqual(entries.length, 1);
				assert.strictEqual(entries[0].langs.en.slug, entry.langs.en.slug);
				assert.strictEqual(entries[0].langs.en.tags, entry.langs.en.tags);
				assert.strictEqual(entries[0].langs.en.header, entry.langs.en.header);
				assert.strictEqual(entries[0].langs.en.summary, entry.langs.en.summary);
				assert.strictEqual(entries[0].langs.en.body, entry.langs.en.body);
				cb();
			});
		});

		async.series(tasks, done);
	});

	it('Dont save entry when slugs already exists', function (done) {
		const entry = {
			langs: {
				en: {
					slug: moment().format('YYYY-MM-DD_') + slugify('One bottle of beer on the floor', '-'),
					tags: 'Beer,Bacon,Moar beer',
					header: 'Its not about the beer',
					summary: 'You\'re wrong!!',
					body: 'I hate beer, no one loves beer.'
				}
			},
			published: moment().subtract(1, 'hours')
				.toDate(), // Fucking timezones
			uuid: entryUuid3
		};

		blogLib.saveEntry(entry, function (err) {
			assert.strictEqual(err !== null, true);
			done();
		});
	});

	it('Edit blog post', function (done) {
		const tasks = [];


		const entry = {
			langs: {
				en: {
					slug: moment().format('YYYY-MM-DD_') + slugify('Bacon, oh, sweet bacon', '-'),
					tags: 'Updated tags, bags',
					header: 'The second comming of the lord of bacon',
					summary: 'All hail the lord of bacon!',
					body: 'I love bacon, everybody loves bacon.'
				}
			},
			published: moment().toDate(),
			uuid: entryUuid
		};

		tasks.push(function (cb) {
			blogLib.saveEntry(entry, cb);
		});

		tasks.push(function (cb) {
			blogLib.getEntries({uuids: entry.uuid}, function (err, entries) {
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

			blogLib.getEntries({uuids: uuids}, function (err, entries) {
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
			blogLib.getEntries({uuids: entryUuid}, function (err, entries) {
				assert.strictEqual(err, null);
				assert.strictEqual(entries.length, 1);
				assert.strictEqual(entries[0].images, null);
				cb();
			});
		});

		tasks.push(function (cb) {
			blogLib.setImages({uuid: entryUuid, images: [{number: 1, uri: '/some/image/file.png'}]}, cb);
		});

		tasks.push(function (cb) {
			blogLib.getEntries({uuids: entryUuid}, function (err, entries) {
				assert.strictEqual(err, null);
				assert.strictEqual(entries.length, 1);
				assert.strictEqual(entries[0].images, '/some/image/file.png');
				cb();
			});
		});

		async.series(tasks, done);
	});

	it('Add an additional image', function (done) {
		const tasks = [];

		let image = null;

		tasks.push(function (cb) {
			blogLib.getEntries({uuids: entryUuid}, function (err, entries) {
				assert.strictEqual(err, null);
				assert.strictEqual(entries.length, 1);
				assert.notStrictEqual(entries[0].images, null);
				image = entries[0].images;
				cb();
			});
		});

		tasks.push(function (cb) {
			blogLib.setImages({uuid: entryUuid, images: [{number: 1, uri: image}, {number: 2, uri: '/some/other/uri.jpeg'}]}, cb);
		});

		tasks.push(function (cb) {
			blogLib.getEntries({uuids: entryUuid}, function (err, entries) {
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
			blogLib.setImages({uuid: entryUuid}, cb);
		});

		tasks.push(function (cb) {
			blogLib.getEntries({uuids: entryUuid}, function (err, entries) {
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
			blogLib.getEntries({uuid: entryUuid}, function (err, entries) {
				assert.strictEqual(err === null, true);
				assert.strictEqual(entries.length, 1);
				assert.strictEqual(entries[0].uuid, entryUuid2);
				cb();
			});
		});

		async.series(tasks, done);
	});
});
