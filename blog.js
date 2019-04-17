/* eslint-disable no-tabs */
'use strict';

const topLogPrefix = 'larvitblog: blog.js: ';
const DataWriter = require(__dirname + '/dataWriter.js');
const Intercom = require('larvitamintercom');
const LUtils = require('larvitutils');

class Blog {

	/**
	 * Constructor
	 *
	 * @param {object} options - construct options
	 * @param {object} options.db - Database instance
	 * @param {string} [options.exchangeName] - Default "larvitblog" - Used as communication channel for larvitamintercom
	 * @param {string} [options.mode] - Default "noSync" - What sync mode to be used on the intercom
	 * @param {object} [options.intercom] - Larvitamintercom instance
	 * @param {object} [options.log] - Logging instance
	 * @param {object} [options.lUtils] - Larvitutils instance
	 * @param {string} [options.amsync_host] - Default: null
	 * @param {integer} [options.amsync_minPort] - Default: null
	 * @param {integer} [options.amsync_maxPort] - Default: null
	 * @param {function} [cb] - Callback function
	 */
	constructor(options, cb) {
		const logPrefix = topLogPrefix + 'constructor() - ';

		this.options = options || {};

		if (!options.db) throw new Error('Missing required option "db"');

		if (!this.options.log) {
			const lUtils = new LUtils();

			this.options.log = new lUtils.Log();
		}

		if (!options.lUtils) options.lUtils = new LUtils({log: this.options.log});

		this.log = this.options.log;

		for (const key of Object.keys(this.options)) {
			this[key] = this.options[key];
		}

		if (!this.exchangeName) {
			this.exchangeName = 'larvitblog';
		}

		if (!this.mode) {
			this.log.info(logPrefix + 'No "mode" option given, defaulting to "noSync"');
			this.mode = 'noSync';
		} else if (['noSync', 'master', 'slave'].indexOf(this.mode) === -1) {
			const err = new Error('Invalid "mode" option given: "' + this.mode + '"');

			this.log.error(logPrefix + err.message);
			throw err;
		}

		if (!this.intercom) {
			this.log.info(logPrefix + 'No "intercom" option given, defaulting to "loopback interface"');
			this.intercom = new Intercom('loopback interface');
		}

		this.dataWriter = new DataWriter({
			exchangeName: this.exchangeName,
			intercom: this.intercom,
			mode: this.mode,
			log: this.log,
			db: this.db,
			amsync_host: this.options.amsync_host || null,
			amsync_minPort: this.options.amsync_minPort || null,
			amsync_maxPort: this.options.amsync_maxPort || null
		}, cb);
	}

	/**
	 * Get entries
	 *
	 * @param {object} [options] - What options to use
	 * @param {Date} [options.publishedAfter] -
	 * @param {Date} [options.publishedBefore] -
	 * @param {Array} [options.langs] - Array of strings
	 * @param {Array} [options.uuids] - Array of strings
	 * @param {Array} [options.slugs] - Array of strings
	 * @param {Array} [options.tags] - Array of strings
	 * @param {integer} [options.limit] - Default: 10
	 * @param {integer} [options.offset] -
	 * @param {function} cb - Calback
	 * @returns {undefined} - Nothing (of value)
	 */
	getEntries(options, cb) {
		const logPrefix = topLogPrefix + 'getEntries() - ';
		const dbFields = [];

		let sql = '';

		if (typeof options === 'function') {
			cb = options;
			options = {};
		}

		if (options.publishedAfter && !options.publishedAfter instanceof Date) {
			const err = new Error('Invalid date format, publishedAfter is not an instance of Date');

			this.log.verbose(logPrefix + err.message);

			return cb(err);
		}

		if (options.publishedBefore && !options.publishedBefore instanceof Date) {
			const err = new Error('Invalid date format, publishedBefore is not an instance of Date');

			this.log.verbose(logPrefix + err.message);

			return cb(err);
		}

		this.log.debug(logPrefix + 'Called with options: "' + JSON.stringify(options) + '"');

		// Make sure options that should be arrays actually are arrays
		// This will simplify our lives in the SQL builder below
		if (options.langs !== undefined && !(options.langs instanceof Array)) {
			options.langs = [options.langs];
		}

		if (options.uuids !== undefined && !(options.uuids instanceof Array)) {
			options.uuids = [options.uuids];
		}

		if (options.slugs !== undefined && !(options.slugs instanceof Array)) {
			options.slugs = [options.slugs];
		}

		if (options.tags !== undefined && !(options.tags instanceof Array)) {
			options.tags = [options.tags];
		}

		// Make sure there is an invalid ID in the id list if it is empty
		// Since the most logical thing to do is replying with an empty set
		if (options.uuids instanceof Array && options.uuids.length === 0) {
			options.uuids.push(-1);
		}

		if (options.limit === undefined) {
			options.limit = 10;
		}

		sql += 'SELECT ed.*, e.uuid, e.created, e.published, GROUP_CONCAT(DISTINCT t.content) AS tags, GROUP_CONCAT(DISTINCT i.uri) AS images\n';
		sql += 'FROM blog_entries e\n';
		sql += '	LEFT JOIN blog_entriesData	ed	ON ed.entryUuid = e.uuid\n';
		sql += '	LEFT JOIN blog_entriesDataTags	t	ON t.entryUuid = e.uuid AND t.lang = ed.lang\n';
		sql += '	LEFT JOIN blog_entriesDataImages	i	ON i.entryUuid = e.uuid\n';
		sql += 'WHERE 1 + 1\n';

		// Only get post contents with selected languages
		if (options.langs !== undefined) {
			// eslint-disable-next-line no-tabs
			sql += '	AND ed.lang IN (';

			for (let i = 0; options.langs[i] !== undefined; i++) {
				sql += '?,';
				dbFields.push(options.langs[i]);
			}

			sql = sql.substring(0, sql.length - 1) + ')\n';
		}

		// Only get posts with the current slugs
		if (options.slugs !== undefined) {
			sql += '	AND e.uuid IN (SELECT entryUuid FROM blog_entriesData WHERE slug IN (';

			for (let i = 0; options.slugs[i] !== undefined; i++) {
				sql += '?,';
				dbFields.push(options.slugs[i]);
			}

			sql = sql.substring(0, sql.length - 1) + '))\n';
		}

		// Only get post contents with selected tags
		if (options.tags !== undefined) {
			sql += '	AND e.uuid IN (SELECT entryUuid FROM blog_entriesDataTags WHERE content IN (';

			for (let i = 0; options.tags[i] !== undefined; i++) {
				sql += '?,';
				dbFields.push(options.tags[i]);
			}

			sql = sql.substring(0, sql.length - 1) + '))\n';
		}

		// Only get posts with given ids
		if (options.uuids !== undefined) {
			sql += '	AND e.uuid IN (';

			for (let i = 0; options.uuids[i] !== undefined; i++) {
				const buffer = this.lUtils.uuidToBuffer(options.uuids[i]);

				if (buffer === false) {
					const err = new Error('Invalid blog uuid');

					log.warn(logPrefix + err.message);

					return cb(err);
				}

				sql += '?,';
				dbFields.push(buffer);
			}

			sql = sql.substring(0, sql.length - 1) + ')\n';
		}

		// Only get posts published after a certain date
		if (options.publishedAfter) {
			sql += '	AND e.published > ?\n';
			dbFields.push(options.publishedAfter);
		}

		// Only get posts published before a certain date
		if (options.publishedBefore) {
			sql += '	AND e.published < ?\n';
			dbFields.push(options.publishedBefore);
		}

		sql += 'GROUP BY e.uuid, ed.lang\n';
		sql += 'ORDER BY e.published DESC, ed.lang, i.imgNr\n';
		sql += 'LIMIT ' + parseInt(options.limit) + '\n';

		if (options.offset !== undefined) {
			sql += ' OFFSET ' + parseInt(options.offset);
		}

		this.db.query(sql, dbFields, (err, rows) => {
			const tmpEntries = {};
			const entries = [];

			if (err) return cb(err);

			for (let i = 0; rows[i] !== undefined; i++) {
				const row = rows[i];

				row.uuid = this.lUtils.formatUuid(row.uuid);

				if (tmpEntries[row.uuid] === undefined) {
					tmpEntries[row.uuid] = {
						uuid: row.uuid,
						created: row.created,
						published: row.published,
						images: row.images,
						langs: {}
					};
				}

				tmpEntries[row.uuid].langs[row.lang] = {
					header: row.header,
					summary: row.summary,
					body: row.body,
					slug: row.slug,
					tags: row.tags
				};
			}

			for (const entryUuid of Object.keys(tmpEntries)) {
				entries.push(tmpEntries[entryUuid]);
			}

			// Make sure sorting is right
			entries.sort(function (a, b) {
				if (a.published > b.published) {
					return -1;
				} else if (a.published < b.published) {
					return 1;
				} else {
					return 0;
				}
			});

			cb(null, entries);
		});
	};

	/**
	 * Get tags
	 *
	 * @param {function} cb - Callback
	 */
	getTags(cb) {
		let sql = 'SELECT COUNT(entryUuid) AS posts, lang, content FROM blog_entriesDataTags GROUP BY lang, content ORDER BY lang, COUNT(entryUuid) DESC;';

		this.db.query(sql, (err, rows) => {
			let tags = {langs: {}};
			let i;

			if (err) return cb(err);

			i = 0;
			while (rows[i] !== undefined) {
				if (tags.langs[rows[i].lang] === undefined) tags.langs[rows[i].lang] = [];

				tags.langs[rows[i].lang].push({
					posts: rows[i].posts,
					content: rows[i].content
				});

				i++;
			}

			cb(null, tags);
		});
	};

	/**
	 * Remove a blog post
	 *
	 * @param {string} uuid - The uuid of the post to be removed
	 * @param {function} cb - Callback
	 */
	rmEntry(uuid, cb) {
		const options = {exchange: this.exchangeName};
		const message = {};

		message.action = 'rmEntry';
		message.params = {};

		message.params.uuid = uuid;

		this.dataWriter.intercom.send(message, options, (err, msgUuid) => {
			if (err) return cb(err);

			this.dataWriter.emitter.once(msgUuid, cb);
		});
	};

	/**
	 * Remove image
	 *
	 * @param {object} options - What to be removed
	 * @param {string} options.uuid - The uuid to be removed
	 * @param {integer} options.imgNr - The imageNr to be removed
	 * @param {function} cb - The callback
	 */
	rmImage(options, cb) {
		const message = {};

		message.action = 'rmImage';
		message.params = {};
		message.params.uuid = options.uuid;
		message.params.imgNr = options.imgNr;

		this.dataWriter.intercom.send(message, {exchange: this.exchangeName}, (err, msgUuid) => {
			if (err) return cb(err);

			this.dataWriter.emitter.once(msgUuid, cb);
		});
	}

	/**
	 * Save blog entry
	 *
	 * @param {object} data - Entry data to be saved
	 * @param {function} cb - Callback
	 */
	saveEntry(data, cb) {
		const options = {exchange: this.exchangeName};
		const message = {};

		message.action = 'saveEntry';
		message.params = {};

		message.params.data = data;

		this.dataWriter.intercom.send(message, options, (err, msgUuid) => {
			if (err) return cb(err);

			this.dataWriter.emitter.once(msgUuid, cb);
		});
	}

	/**
	 * Set images
	 *
	 * @param {object} data -
	 * @param {function} cb - The callback
	 */
	setImages(data, cb) {
		const options = {exchange: this.exchangeName};
		const message = {};

		message.action = 'setImages';
		message.params = {};

		message.params.data = data;

		this.dataWriter.intercom.send(message, options, (err, msgUuid) => {
			if (err) return cb(err);

			this.dataWriter.emitter.once(msgUuid, cb);
		});
	};

	/**
	 * Search for a blog post
	 *
	 * @param {object/string} options - In case of string, will be used as options.searchText
	 * @param {string} [options.searchText] - What text to search for
	 * @param {Array} [options.tags] - Array of strings
	 * @param {function} cb - The callback
	 */
	search(options, cb) {
		const logPrefix = topLogPrefix + 'search() - ';
		const dbFields = [];

		let sql = 'SELECT entryUuid FROM blog_entriesData WHERE MATCH (header,body,summary) AGAINST (? IN NATURAL LANGUAGE MODE) AND entryUuid IN (SELECT uuid FROM blog_entries WHERE published <= NOW())';

		if (typeof options === 'string') {
			dbFields.push(options);
		} else {
			dbFields.push(options.searchText);
		}

		if (options.tags && options.tags.length > 0) {
			if (!Array.isArray(options.tags)) options.tags = [options.tags];

			for (const t of options.tags) {
				sql += ' AND entryUuid IN (SELECT DISTINCT entryUuid FROM blog_entriesDataTags WHERE content = ?)';
				dbFields.push(t);
			}
		}

		this.db.query(sql, dbFields, (err, rows) => {
			const result = [];

			if (err) {
				this.log.warn(logPrefix + 'search failed: ' + err.message);
				cb(err);
			}

			for (const row of rows) {
				result.push(this.lUtils.formatUuid(row.entryUuid));
			}

			cb(null, result);
		});
	}
}

module.exports = exports = Blog;
