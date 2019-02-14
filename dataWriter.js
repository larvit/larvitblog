'use strict';

const EventEmitter = require('events').EventEmitter;
const topLogPrefix = 'larvitblog: dataWriter.js: ';
const DbMigration = require('larvitdbmigration');
const slugify = require('larvitslugify');
const LUtils = require('larvitutils');
const amsync = require('larvitamsync');
const async = require('async');
const db = require('larvitdb');
const _ = require('lodash');

class DataWriter {
	constructor(options, cb) {
		this.readyInProgress = false;
		this.isReady = false;

		if (!options.log) {
			const tmpLUtils = new LUtils();

			options.log = new tmpLUtils.Log();
		}

		this.options = options;

		for (const key of Object.keys(options)) {
			this[key] = options[key];
		}

		this.lUtils = new LUtils({log: this.log});

		this.emitter = new EventEmitter();

		this.listenToQueue(cb);
	}

	listenToQueue(retries, cb) {
		const logPrefix = topLogPrefix + 'listenToQueue() - ';
		const options = {exchange: this.exchangeName};
		const tasks = [];

		let listenMethod;

		if (typeof retries === 'function') {
			cb = retries;
			retries = 0;
		}

		if (typeof cb !== 'function') {
			cb = function () {};
		}

		if (retries === undefined) {
			retries = 0;
		}

		tasks.push(cb => {
			if (this.mode === 'master') {
				listenMethod = 'consume';
				options.exclusive = true; // It is important no other client tries to sneak
				//  out messages from us, and we want "consume"
				// since we want the queue to persist even if this
				// minion goes offline.
			} else if (this.mode === 'slave' || this.mode === 'noSync') {
				listenMethod = 'subscribe';
			} else {
				const err = new Error('Invalid this.mode. Must be either "master", "slave" or "noSync"');

				this.log.error(logPrefix + err.message);

				return cb(err);
			}

			this.log.info(logPrefix + 'listenMethod: ' + listenMethod);

			cb();
		});

		tasks.push(cb => {
			this.ready(cb);
		});

		tasks.push(cb => {
			this.intercom[listenMethod](options, (message, ack, deliveryTag) => {
				this.ready(err => {
					ack(err); // Ack first, if something goes wrong wethis.log.it and handle it manually

					if (err) {
						this.log.error(logPrefix + 'intercom.' + listenMethod + '() - this.ready() returned err: ' + err.message);

						return;
					}

					if (typeof message !== 'object') {
						this.log.error(logPrefix + 'intercom.' + listenMethod + '() - Invalid message received, is not an object! deliveryTag: "' + deliveryTag + '"');

						return;
					}

					if (typeof this[message.action] === 'function') {
						this[message.action](message.params, deliveryTag, message.uuid);
					} else {
						this.log.warn(logPrefix + 'intercom.' + listenMethod + '() - Unknown message.action received: "' + message.action + '"');
					}
				});
			}, cb);
		});

		async.series(tasks, cb);
	}

	// This is ran before each incoming message on the queue is handeled
	ready(retries, cb) {
		const logPrefix = topLogPrefix + 'ready() - ';


		const tasks = [];

		if (typeof retries === 'function') {
			cb = retries;
			retries = 0;
		}

		if (typeof cb !== 'function') {
			cb = function () {};
		}

		if (retries === undefined) {
			retries = 0;
		}

		tasks.push(cb => {
			if (this.mode === 'slave') {
				this.log.verbose(logPrefix + 'this.mode: "' + this.mode + '", so read');

				amsync.mariadb({
					exchange: this.exchangeName + '_dataDump',
					intercom: this.intercom,
					log: this.log,
					db: this.db
				}, cb);
			} else {
				cb();
			}
		});

		// Migrate database
		tasks.push(cb => {
			const options = {};

			let dbMigration;

			options.dbType = 'mariadb';
			options.dbDriver = this.db;
			options.tableName = 'blog_db_version';
			options.migrationScriptsPath = __dirname + '/dbmigration';
			options.log = this.log;
			dbMigration = new DbMigration(options);

			dbMigration.run(err => {
				if (err) {
					this.log.error(logPrefix + 'Database error: ' + err.message);
				}

				cb(err);
			});
		});

		async.series(tasks, err => {
			if (err) return;

			this.isReady = true;
			this.emitter.emit('ready');

			if (this.mode === 'both' || this.mode === 'master') {
				this.runDumpServer(cb);
			} else {
				cb();
			}
		});
	}

	runDumpServer(cb) {
		const options = {
			exchange: this.exchangeName + '_dataDump',
			host: this.options.amsync ? this.options.amsync.host : null,
			minPort: this.options.amsync ? this.options.amsync.minPort : null,
			maxPort: this.options.amsync ? this.options.amsync.maxPort : null,
			'Content-Type': 'application/sql',
			intercom: this.intercom
		};


		const args = [];

		if (this.db.conf.host) {
			args.push('-h');
			args.push(db.conf.host);
		}

		args.push('-u');
		args.push(this.db.conf.user);

		if (this.db.conf.password) {
			args.push('-p' + db.conf.password);
		}

		args.push('--single-transaction');
		args.push('--hex-blob');
		args.push(this.db.conf.database);

		// Tables
		args.push('blog_db_version');
		args.push('blog_entries');
		args.push('blog_entriesData');
		args.push('blog_entriesDataTags');
		args.push('blog_entriesDataImages');

		options.dataDumpCmd = {
			command: 'mysqldump',
			args: args
		};

		new amsync.SyncServer(options, cb);
	}

	rmEntry(params, deliveryTag, msgUuid) {
		const uuid = this.lUtils.uuidToBuffer(params.uuid);
		const tasks = [];

		if (uuid === false) {
			const e = new Error('Invalid uuid');

			this.log.warn(topLogPrefix + 'rmEntry() - ' + e.message);

			return this.emitter.emit(msgUuid, e);
		}

		tasks.push(cb => {
			this.db.query('DELETE FROM blog_entriesDataTags WHERE entryUuid = ?', [uuid], cb);
		});

		tasks.push(cb => {
			this.db.query('DELETE FROM blog_entriesDataImages WHERE entryUuid = ?', [uuid], cb);
		});

		tasks.push(cb => {
			this.db.query('DELETE FROM blog_entriesData WHERE entryUuid = ?', [uuid], cb);
		});

		tasks.push(cb => {
			this.db.query('DELETE FROM blog_entries WHERE uuid = ?', [uuid], cb);
		});

		async.series(tasks, err => {
			this.emitter.emit(msgUuid, err);
		});
	}

	rmImage(params, deliveryTag, msgUuid) {
		const logPrefix = topLogPrefix + 'rmImage() -';
		const uuidBuffer = this.lUtils.uuidToBuffer(params.uuid);

		if (uuidBuffer === false) {
			this.log.warn(logPrefix + 'Invalid uuid');

			return this.emitter.emit(msgUuid, new Error('Invalid uuid'));
		}

		if (isNaN(Number(params.imgNr))) {
			this.log.warn(logPrefix + 'Invalid imgNr');

			return this.emitter.emit(msgUuid, new Error('Invalid imgNr'));
		}

		this.db.query('DELETE FROM blog_entriesDataImages WHERE entryUuid = ? AND imgNr = ?', [uuidBuffer, params.imgNr], err => {
			this.emitter.emit(msgUuid, err);
		});
	}

	saveEntry(params, deliveryTag, msgUuid) {
		const logPrefix = topLogPrefix + 'saveEntry() - ';
		const tasks = [];
		const data = params.data;
		const uuidBuffer = this.lUtils.uuidToBuffer(data.uuid);

		this.log.debug(logPrefix + 'Running with data. "' + JSON.stringify(data) + '"');

		// Create a new post id is not set
		if (data.uuid === undefined) {
			this.log.warn(logPrefix + 'Uuid not set on blog post');

			return this.emitter.emit(msgUuid, new Error('Uuid not set'));
		}

		if (uuidBuffer === undefined) {
			this.log.warn(logPrefix + 'Invalid uuid set on blog post');

			return this.emitter.emit(msgUuid, new Error('Invalid uuid set on blog post'));
		}

		if (data.published && !data.published instanceof Date) {
			this.log.info(logPrefix + 'Invalid "published" value, not an instance of Date');

			return this.emitter.emit(msgUuid, new Error('Invalid "published" value, not an instance of Date'));
		}

		// Check if slugs already exists
		if (data.langs !== undefined) {
			tasks.push(cb => {
				const dbFields = [];

				let sql = 'SELECT * FROM blog_entriesData WHERE slug IN (';

				for (const lang in data.langs) {
					sql += '?,';
					dbFields.push(slugify(data.langs[lang].slug, {save: ['/', '-']}));
				}

				sql = sql.substring(0, sql.length - 1) + ') ';
				sql += 'AND entryUuid != ?';
				dbFields.push(uuidBuffer);

				this.db.query(sql, dbFields, (err, result) => {
					if (err) return cb(err);

					if (result.length > 0) {
						this.log.debug(logPrefix + 'Slug already exists');

						return cb(new Error('Slug already exists'));
					}

					cb();
				});
			});
		}

		// Save blog uuid
		tasks.push(cb => {
			const dbFields = [];

			let sql = 'INSERT IGNORE INTO blog_entries (uuid, created';

			dbFields.push(uuidBuffer);

			if (data.published) {
				sql += ', published';
			}

			sql += ') VALUES (?, NOW()';

			if (data.published) {
				sql += ', ?';
				dbFields.push(data.published);
			}

			sql += ');';

			this.db.query(sql, dbFields, (err, result) => {
				if (err) return cb(err);

				if (result.affectedRows === 1) {
					this.log.debug(logPrefix + 'New blog entry created with uuid: "' + data.uuid + '"');
				}

				cb();
			});
		});

		// Save when published (move?)
		if (data.published !== undefined) {
			tasks.push(cb => {
				const sql = 'UPDATE blog_entries SET published = ? WHERE uuid = ?';


				const dbFields = [data.published, uuidBuffer];

				this.db.query(sql, dbFields, cb);
			});
		}

		// Remove data. If blog post exists old data is removed and if not, nothing happens
		tasks.push(cb => {
			this.db.query('DELETE FROM blog_entriesData WHERE entryUuid = ?', [uuidBuffer], cb);
		});

		// Remove tags. If blog post exists old tags is removed and if not, nothing happens
		tasks.push(cb => {
			this.db.query('DELETE FROM blog_entriesDataTags WHERE entryUuid = ?', [uuidBuffer], cb);
		});

		// We need to declare this outside the loop because of async operations
		const addEntryData = (lang, header, summary, body, slug) => {
			tasks.push(cb => {
				const sql = 'INSERT INTO blog_entriesData (entryUuid, lang, header, summary, body, slug) VALUES(?,?,?,?,?,?);';
				const dbFields = [uuidBuffer, lang, header, summary, body, slug];

				this.db.query(sql, dbFields, cb);
			});
		};

		const addTagData = (lang, content) => {
			tasks.push(cb => {
				const sql = 'INSERT INTO blog_entriesDataTags (entryUuid, lang, content) VALUES(?,?,?);';
				const dbFields = [uuidBuffer, lang, content];

				this.db.query(sql, dbFields, cb);
			});
		};

		// Add content data
		if (data.langs !== undefined) {
			for (const lang in data.langs) {
				if (data.langs[lang].slug) data.langs[lang].slug = slugify(data.langs[lang].slug, {save: ['/', '-']});

				if (data.langs[lang].header || data.langs[lang].body || data.langs[lang].summary) {
					addEntryData(lang, data.langs[lang].header, data.langs[lang].summary, data.langs[lang].body, data.langs[lang].slug);

					if (data.langs[lang].tags) {
						_.each(data.langs[lang].tags.split(','), tagContent => {
							addTagData(lang, _.trim(tagContent));
						});
					}
				}
			}
		}

		async.series(tasks, (err) => {
			this.emitter.emit(msgUuid, err);
		});
	}

	setImages(params, deliveryTag, msgUuid) {
		const options = params.data;
		const logPrefix = topLogPrefix + 'setImages() - ';
		const uuidBuffer = this.lUtils.uuidToBuffer(options.uuid);
		const tasks = [];

		if (options.delete === undefined) options.delete = true; // This is the default behavior

		if (options.uuid === undefined) {
			const err = new Error('entryUuid not provided');

			this.log.warn(logPrefix + err.message);

			return this.emitter.emit(msgUuid, err);
		}

		if (uuidBuffer === false) {
			const err = new Error('Invalid entryUuid provided');

			this.log.warn(logPrefix + err.message);

			return this.emitter.emit(msgUuid, err);
		}

		if (options.delete) {
			tasks.push(cb => {
				this.db.query('DELETE FROM blog_entriesDataImages WHERE entryUuid = ?', [uuidBuffer], cb);
			});
		}

		if (options.images !== undefined) {
			for (const img of options.images) {
				tasks.push(cb => {
					this.db.query('INSERT INTO blog_entriesDataImages (entryUuid, imgNr, uri) VALUES(?, ?, ?);', [uuidBuffer, img.number, img.uri], cb);
				});
			}
		}

		async.series(tasks, err => {
			this.emitter.emit(msgUuid, err);
		});
	};
}

module.exports = exports = DataWriter;
