'use strict';

const	topLogPrefix	= 'larvitblog: blog.js: ',
	events	= require('events'),
	eventEmitter	= new events.EventEmitter(),
	dataWriter	= require(__dirname + '/dataWriter.js'),
	slugify	= require('larvitslugify'),
	async	= require('async'),
	log	= require('winston'),
	db	= require('larvitdb'),
	_	= require('lodash');

/**
 * Get blog entries
 *
 * @param obj options -	{	// All options are optional!
 *		'langs': ['sv', 'en'],
 *		'slugs': ['blu', 'bla'],
 *		'publishedAfter': dateObj,
 *		'publishedBefore': dateObj,
 *		'tags': ['dks', 'ccc'],
 *		'ids': [32,4],
 *		'limit': 10,
 *		'offset': 20
 *	}
 * @param func cb - callback(err, entries)
 */
function getEntries(options, cb) {
	const	logPrefix	= topLogPrefix + 'getEntries() - ',
		dbFields	= [];

	let	sql	= '';

	if (typeof options === 'function') {
		cb      = options;
		options = {};
	}

	log.debug(logPrefix + 'Called with options: "' + JSON.stringify(options) + '"');

	// Make sure options that should be arrays actually are arrays
	// This will simplify our lives in the SQL builder below
	if (options.langs !== undefined && ! (options.langs instanceof Array)) {
		options.langs = [options.langs];
	}

	if (options.uuids !== undefined && ! (options.uuids instanceof Array)) {
		options.uuids = [options.uuids];
	}

	if (options.slugs !== undefined && ! (options.slugs instanceof Array)) {
		options.slugs = [options.slugs];
	}

	if (options.tags !== undefined && ! (options.tags instanceof Array)) {
		options.tags = [options.tags];
	}

	// Make sure there is an invalid ID in the id list if it is empty
	// Since the most logical thing to do is replying with an empty set
	if (options.uuids instanceof Array && options.uuids.length === 0) {
		options.uuids.push(- 1);
	}

	if (options.limit === undefined) {
		options.limit = 10;
	}

	sql += 'SELECT ed.*, e.uuid, e.created, e.published, GROUP_CONCAT(DISTINCT t.content) AS tags, GROUP_CONCAT(DISTINCT i.uri) AS images\n';
	sql += 'FROM blog_entries e\n';
	sql += '	LEFT JOIN blog_entriesData	ed	ON ed.entryUuid	= e.uuid\n';
	sql += '	LEFT JOIN blog_entriesDataTags	t	ON t.entryUuid	= e.uuid AND t.lang = ed.lang\n';
	sql += '	LEFT JOIN blog_entriesDataImages	i	ON i.entryUuid	= e.uuid\n';
	sql += 'WHERE 1 + 1\n';

	// Only get post contents with selected languages
	if (options.langs !== undefined) {
		sql += '	AND ed.lang IN (';

		for (let i = 0; options.langs[i] !== undefined; i ++) {
			sql += '?,';
			dbFields.push(options.langs[i]);
		}

		sql = sql.substring(0, sql.length - 1) + ')\n';
	}

	// Only get posts with the current slugs
	if (options.slugs !== undefined) {
		sql += '	AND e.uuid IN (SELECT entryUuid FROM blog_entriesData WHERE slug IN (';

		for (let i = 0; options.slugs[i] !== undefined; i ++) {
			sql += '?,';
			dbFields.push(options.slugs[i]);
		}

		sql = sql.substring(0, sql.length - 1) + '))\n';
	}

	// Only get post contents with selected tags
	if (options.tags !== undefined) {
		sql += '	AND e.uuid IN (SELECT entryUuid FROM blog_entriesDataTags WHERE content IN (';

		for (let i = 0; options.tags[i] !== undefined; i ++) {
			sql += '?,';
			dbFields.push(options.tags[i]);
		}

		sql = sql.substring(0, sql.length - 1) + '))\n';
	}

	// Only get posts with given ids
	if (options.uuids !== undefined) {
		sql += '	AND e.uuid IN (';

		for (let i = 0; options.uuids[i] !== undefined; i ++) {
			sql += '?,';
			dbFields.push(options.uuids[i]);
		}

		sql = sql.substring(0, sql.length - 1) + ')\n';
	}

	// Only get posts published after a certain date
	if (options.publishedAfter) {
		sql += '	AND e.published > ?\n';
		dbFields.push(new Date(options.publishedAfter));
	}

	// Only get posts published before a certain date
	if (options.publishedBefore) {
		sql += '	AND e.published < ?\n';
		dbFields.push(new Date(options.publishedBefore));
	}

	sql += 'GROUP BY e.uuid, ed.lang\n';
	sql += 'ORDER BY e.published DESC, ed.lang, i.imgNr\n';
	sql += 'LIMIT ' + parseInt(options.limit) + '\n';

	if (options.offset !== undefined) {
		sql += ' OFFSET ' + parseInt(options.offset);
	}

	db.query(sql, dbFields, function (err, rows) {
		const	tmpEntries	= {},
			entries	= [];

		if (err) return cb(err);

		for (let i = 0; rows[i] !== undefined; i ++) {
			const	row	= rows[i];

			row.uuid	= lUtils.formatUuid(row.uuid);

			if (tmpEntries[row.uuid] === undefined) {
				tmpEntries[row.uuid] = {
					'uuid':	row.uuid,
					'created':	row.created,
					'published':	row.published,
					'images':	row.images,
					'langs':	{}
				};
			}

			tmpEntries[row.uuid].langs[row.lang] = {
				'header':	row.header,
				'summary':	row.summary,
				'body':	row.body,
				'slug':	row.slug,
				'tags':	row.tags
			};
		}

		for (const entryUuid of Object.keys(tmpEntries)) {
			entries.push(tmpEntries[entryUuid]);
		}

		// Make sure sorting is right
		entries.sort(function (a, b) {
			if (a.published > b.published) {
				return - 1;
			} else if (a.published < b.published) {
				return 1;
			} else {
				return 0;
			}
		});

		cb(null, entries);
	});
};

function getTags(cb) {
	let sql = 'SELECT COUNT(entryUuid) AS posts, lang, content FROM blog_entriesDataTags GROUP BY lang, content ORDER BY lang, COUNT(entryUuid) DESC;';

	db.query(sql, function (err, rows) {
		let tags = {'langs': {}},
		    i;

		if (err) return cb(err);

		i = 0;
		while (rows[i] !== undefined) {
			if (tags.langs[rows[i].lang] === undefined)
				tags.langs[rows[i].lang] = [];

			tags.langs[rows[i].lang].push({
				'posts': rows[i].posts,
				'content': rows[i].content
			});

			i ++;
		}

		cb(null, tags);
	});
}

function rmEntry(uuid, cb) {
	const	options	= {'exchange': dataWriter.exchangeName},
		message	= {};

	message.action	= 'rmEntry';
	message.params	= {};

	message.params.uuid	= uuid;

	intercom.send(message, options, function (err, msgUuid) {
		if (err) return cb(err);

		dataWriter.emitter.once(msgUuid, cb);
	});
}

/**
 * Save an entry
 *
 * @param obj data - { // All options are optional!
 *                     'id': 1323,
 *                     'published': dateObj,
 *                     'langs': {
 *                       'en': {
 *                         'header': 'foo',
 *                         'slug': 'bar',
 *                         'summary': 'lots of foo and bars'
 *                         'body': 'even more foos and bars'
 *                         'tags': 'comma,separated,string'
 *                       },
 *                       'sv' ...
 *                     }
 *                   }
 * @param func cb(err, entry) - the entry will be a row from getEntries()
 */
function saveEntry(data, cb) {
	var tasks = [],
	    lang;

	if (typeof data === 'function') {
		cb   = data;
		data = {};
	}

	log.verbose('larvitblog: saveEntry() - Running with data. "' + JSON.stringify(data) + '"');

	// Make sure the database tables exists before going further!
	if ( ! dbChecked) {
		log.debug('larvitblog: saveEntry() - Database not checked, rerunning this method when event have been emitted.');
		eventEmitter.on('checked', function () {
			log.debug('larvitblog: saveEntry() - Database check event received, rerunning saveEntry().');
			exports.saveEntry(data, cb);
		});

		return;
	}

	// Create a new post id is not set
	if (data.id === undefined) {
		tasks.push(function (cb) {
			var sql      = 'INSERT INTO blog_entries (created',
				  dbFields = [];

			if (data.published)
				sql += ', published';

			sql += ') VALUES(NOW()';

			if (data.published) {
				sql += ',?';
				dbFields.push(data.published);
			}

			sql += ');';

			db.query(sql, dbFields, function (err, result) {
				if (err) {
					cb(err);
					return;
				}

				log.debug('larvitblog: saveEntry() - New blog entry created with id: "' + result.insertId + '"');
				data.id = result.insertId;
				cb();
			});
		});
	} else {
		// Erase previous data
		tasks.push(function (cb) {
			db.query('DELETE FROM blog_entriesData WHERE entryId = ?', [parseInt(data.id)], cb);
		});

		// Set published
		if (data.published !== undefined) {
			tasks.push(function (cb) {
				var sql      = 'UPDATE blog_entries SET published = ? WHERE id = ?',
				    dbFields = [data.published, data.id];

				db.query(sql, dbFields, cb);
			});
		}
	}

	// We need to declare this outside the loop because of async operations
	function addEntryData(lang, header, summary, body, slug) {
		tasks.push(function (cb) {
			var sql      = 'INSERT INTO blog_entriesData (entryId, lang, header, summary, body, slug) VALUES(?,?,?,?,?,?);',
			    dbFields = [data.id, lang, header, summary, body, slug];

			db.query(sql, dbFields, cb);
		});
	}

	function addTagData(lang, content) {
		tasks.push(function (cb) {
			var sql      = 'INSERT INTO blog_entriesDataTags (entryId, lang, content) VALUES(?,?,?);',
			    dbFields = [data.id, lang, content];

			db.query(sql, dbFields, cb);
		});
	}

	// Add content data
	if (data.langs) {
		tasks.push(function (cb) {
			db.query('DELETE FROM blog_entriesDataTags WHERE entryId = ?', [data.id], cb);
		});

		for (lang in data.langs) {
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
		if (err) {
			cb(err);
			return;
		}

		// Re-read this entry from the database to be sure to get the right deal!
		getEntries({'ids': data.id}, function (err, entries) {
			if (err) {
				cb(err);
				return;
			}

			cb(null, entries[0]);
		});
	});
};

exports.getEntries = getEntries;
exports.getTags    = getTags;
exports.rmEntry    = rmEntry;
exports.saveEntry  = saveEntry;
