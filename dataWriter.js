'use strict';

const	EventEmitter	= require('events').EventEmitter,
	eventEmitter	= new EventEmitter(),
	topLogPrefix	= 'larvitblog: dataWriter.js: ',
	DbMigration	= require('larvitdbmigration'),
	lUtils	= require('larvitutils'),
	amsync	= require('larvitamsync'),
	async	= require('async'),
	log	= require('winston'),
	db	= require('larvitdb'),
	slugify	= require('slugify'),
	_	= require('lodash');


let	readyInProgress	= false,
	isReady	= false,
	intercom;

function listenToQueue(retries, cb) {
	const	logPrefix	= topLogPrefix + 'listenToQueue() - ',
		options	= {'exchange': exports.exchangeName};

	let	listenMethod;

	if (typeof retries === 'function') {
		cb	= retries;
		retries	= 0;
	}

	if (typeof cb !== 'function') {
		cb = function (){};
	}

	if (retries === undefined) {
		retries = 0;
	}

	if (exports.mode === 'master') {
		listenMethod	= 'consume';
		options.exclusive	= true;	// It is important no other client tries to sneak
				// out messages from us, and we want "consume"
				// since we want the queue to persist even if this
				// minion goes offline.
	} else if (exports.mode === 'slave' || exports.mode === 'noSync') {
		listenMethod = 'subscribe';
	} else {
		const	err	= new Error('Invalid exports.mode. Must be either "master", "slave" or "noSync"');
		log.error(logPrefix + err.message);
		return cb(err);
	}

	intercom	= require('larvitutils').instances.intercom;

	if ( ! (intercom instanceof require('larvitamintercom')) && retries < 10) {
		retries ++;
		setTimeout(function () {
			listenToQueue(retries, cb);
		}, 50);
		return;
	} else if ( ! (intercom instanceof require('larvitamintercom'))) {
		log.error(logPrefix + 'Intercom is not set!');
		return;
	}

	log.info(logPrefix + 'listenMethod: ' + listenMethod);

	intercom.ready(function (err) {
		if (err) {
			log.error(logPrefix + 'intercom.ready() err: ' + err.message);
			return;
		}

		intercom[listenMethod](options, function (message, ack, deliveryTag) {
			exports.ready(function (err) {
				ack(err); // Ack first, if something goes wrong we log it and handle it manually

				if (err) {
					log.error(logPrefix + 'intercom.' + listenMethod + '() - exports.ready() returned err: ' + err.message);
					return;
				}

				if (typeof message !== 'object') {
					log.error(logPrefix + 'intercom.' + listenMethod + '() - Invalid message received, is not an object! deliveryTag: "' + deliveryTag + '"');
					return;
				}

				if (typeof exports[message.action] === 'function') {
					exports[message.action](message.params, deliveryTag, message.uuid);
				} else {
					log.warn(logPrefix + 'intercom.' + listenMethod + '() - Unknown message.action received: "' + message.action + '"');
				}
			});
		}, ready);
	});
}
// Run listenToQueue as soon as all I/O is done, this makes sure the exports.mode can be set
// by the application before listening commences
setImmediate(listenToQueue);

// This is ran before each incoming message on the queue is handeled
function ready(retries, cb) {
	const	logPrefix	= topLogPrefix + 'ready() - ',
		tasks	= [];

	if (typeof retries === 'function') {
		cb	= retries;
		retries	= 0;
	}

	if (typeof cb !== 'function') {
		cb = function (){};
	}

	if (retries === undefined) {
		retries	= 0;
	}

	if (isReady === true) return cb();

	if (readyInProgress === true) {
		eventEmitter.on('ready', cb);
		return;
	}

	intercom	= require('larvitutils').instances.intercom;

	if ( ! (intercom instanceof require('larvitamintercom')) && retries < 10) {
		retries ++;
		setTimeout(function () {
			ready(retries, cb);
		}, 50);
		return;
	} else if ( ! (intercom instanceof require('larvitamintercom'))) {
		log.error(logPrefix + 'Intercom is not set!');
		return;
	}

	readyInProgress = true;

	if (exports.mode === 'both' || exports.mode === 'slave') {
		log.verbose(logPrefix + 'exports.mode: "' + exports.mode + '", so read');

		tasks.push(function (cb) {
			amsync.mariadb({'exchange': exports.exchangeName + '_dataDump'}, cb);
		});
	}

	// Migrate database
	tasks.push(function (cb) {
		const	options	= {};

		let	dbMigration;

		options.dbType	= 'larvitdb';
		options.dbDriver	= db;
		options.tableName	= 'blog_db_version';
		options.migrationScriptsPath	= __dirname + '/dbmigration';
		dbMigration	= new DbMigration(options);

		dbMigration.run(function (err) {
			if (err) {
				log.error(logPrefix + 'Database error: ' + err.message);
			}

			cb(err);
		});
	});

	async.series(tasks, function (err) {
		if (err) return;

		isReady	= true;
		eventEmitter.emit('ready');

		if (exports.mode === 'both' || exports.mode === 'master') {
			runDumpServer(cb);
		} else {
			cb();
		}
	});
}

function runDumpServer(cb) {
	const	options	= {'exchange': exports.exchangeName + '_dataDump'},
		args	= [];

	if (db.conf.host) {
		args.push('-h');
		args.push(db.conf.host);
	}

	args.push('-u');
	args.push(db.conf.user);

	if (db.conf.password) {
		args.push('-p' + db.conf.password);
	}

	args.push('--single-transaction');
	args.push('--hex-blob');
	args.push(db.conf.database);

	// Tables
	args.push('blog_entries');
	args.push('blog_entriesData');
	args.push('blog_entriesDataTags');
	args.push('blog_entriesDataImages');

	options.dataDumpCmd = {
		'command':	'mysqldump',
		'args':	args
	};

	options['Content-Type'] = 'application/sql';

	new amsync.SyncServer(options, cb);
}

function rmEntry(params, deliveryTag, msgUuid) {
	const	uuid	= lUtils.uuidToBuffer(params.uuid),
		tasks	= [];

	tasks.push(function (cb) {
		db.query('DELETE FROM blog_entriesDataTags WHERE entryUuid = ?', [uuid], cb);
	});

	tasks.push(function (cb) {
		db.query('DELETE FROM blog_entriesDataImages WHERE entryUuid = ?', [uuid], cb);
	});

	tasks.push(function (cb) {
		db.query('DELETE FROM blog_entriesData WHERE entryUuid = ?', [uuid], cb);
	});

	tasks.push(function (cb) {
		db.query('DELETE FROM blog_entries WHERE uuid = ?', [uuid], cb);
	});

	async.series(tasks, function (err) {
		exports.emitter.emit(msgUuid, err);
	});
}

function saveEntry(params, deliveryTag, msgUuid) {

	const logPrefix = topLogPrefix + 'saveEntry() -',
		tasks	= [],
		 data	= params.data;

	log.verbose(logPrefix + 'Running with data. "' + JSON.stringify(data) + '"');

	// Create a new post id is not set
	if (data.uuid === undefined) {
		log.warn(logPrefix + 'Uuid not set on blog post');
		return exports.emitter.emit(msgUuid, new Error('Uuid not set'));
	}

	tasks.push(function (cb) {
		const dbFields	= [];

		let sql      = 'INSERT IGNORE INTO blog_entries (uuid, created';

		dbFields.push(lUtils.uuidToBuffer(data.uuid));

		if (data.published) {
			sql += ', published';
		}

		sql += ') VALUES (?, NOW()';

		if (data.published) {
			sql += ', ?';
			dbFields.push(data.published);
		}

		sql += ');';

		db.query(sql, dbFields, function (err, result) {
			if (err) return cb(err);

			if (result.affectedRows === 1) {
				log.debug(logPrefix + 'New blog entry created with uuid: "' + data.uuid + '"');
			}

			cb();
		});
	});

	if (data.published !== undefined) {
		tasks.push(function (cb) {
			const sql      = 'UPDATE blog_entries SET published = ? WHERE uuid = ?',
				dbFields = [data.published, lUtils.uuidToBuffer(data.uuid)];

			db.query(sql, dbFields, cb);
		});
	}

	// remove data. If blog post exists old data is removed and if not, nothing happens
	tasks.push(function (cb) {
		db.query('DELETE FROM blog_entriesData WHERE entryUuid = ?', [lUtils.uuidToBuffer(data.uuid)], cb);
	});

	// We need to declare this outside the loop because of async operations
	function addEntryData(lang, header, summary, body, slug) {
		tasks.push(function (cb) {
			const sql      = 'INSERT INTO blog_entriesData (entryUuid, lang, header, summary, body, slug) VALUES(?,?,?,?,?,?);',
			    dbFields = [lUtils.uuidToBuffer(data.uuid), lang, header, summary, body, slug];

			db.query(sql, dbFields, cb);
		});
	}

	function addTagData(lang, content) {
		tasks.push(function (cb) {
			const sql      = 'INSERT INTO blog_entriesDataTags (entryUuid, lang, content) VALUES(?,?,?);',
			    dbFields = [lUtils.uuidToBuffer(data.uuid), lang, content];

			db.query(sql, dbFields, cb);
		});
	}

	// Add content data
	if (data.langs !== undefined) {
		tasks.push(function (cb) {
			db.query('DELETE FROM blog_entriesDataTags WHERE entryUuid = ?', [lUtils.uuidToBuffer(data.uuid)], cb);
		});

		for (const lang in data.langs) {
			if (data.langs[lang].slug)
				data.langs[lang].slug = slugify(data.langs[lang].slug, {'save': '/'});

			if (data.langs[lang].header || data.langs[lang].body || data.langs[lang].summary) {
				addEntryData(lang, data.langs[lang].header, data.langs[lang].summary, data.langs[lang].body, data.langs[lang].slug);

				if (data.langs[lang].tags) {
					_.each(data.langs[lang].tags.split(','), function (tagContent) {
						addTagData(lang, _.trim(tagContent));
					});
				}
			}
		}
	}

	async.series(tasks, function (err) {
		exports.emitter.emit(msgUuid, err);
	});
}

exports.emitter	= new EventEmitter();
exports.exchangeName	= 'larvitblog';
exports.ready	= ready;
exports.rmEntry	= rmEntry;
exports.saveEntry	= saveEntry;
