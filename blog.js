'use strict';

var _            = require('lodash'),
    db           = require('larvitdb'),
    log          = require('winston'),
    async        = require('async'),
    events       = require('events'),
    slugify      = require('larvitslugify'),
    dbmigration  = require('larvitdbmigration')({'tableName': 'blog_db_version', 'migrationScriptsPath': __dirname + '/dbmigration'}),
    eventEmitter = new events.EventEmitter(),
    dbChecked    = false;

// Handle database migrations
dbmigration(function(err) {
	if (err) {
		log.error('larvitblog: createTablesIfNotExists() - Database error: ' + err.message);
		return;
	}

	dbChecked = true;
	eventEmitter.emit('checked');
});

/**
 * Get blog entries
 *
 * @param obj options - { // All options are optional!
 *                        'langs': ['sv', 'en'],
 *                        'slugs': ['blu', 'bla'],
 *                        'publishedAfter': dateObj,
 *                        'publishedBefore': dateObj,
 *                        'tags': ['dks', 'ccc'],
 *                        'ids': [32,4],
 *                        'limit': 10,
 *                        'offset': 20
 *                      }
 * @param func cb - callback(err, entries)
 */
function getEntries(options, cb) {
	var tmpEntries = {},
	    dbFields   = [],
	    entries    = [],
	    sql,
	    i;

	if (typeof options === 'function') {
		cb      = options;
		options = {};
	}

	log.debug('larvitblog: getEntries() - Called with options: "' + JSON.stringify(options) + '"');

	// Make sure options that should be arrays actually are arrays
	// This will simplify our lives in the SQL builder below
	if (options.langs !== undefined && ! (options.langs instanceof Array))
		options.langs = [options.langs];

	if (options.ids !== undefined && ! (options.ids instanceof Array))
		options.ids = [options.ids];

	if (options.slugs !== undefined && ! (options.slugs instanceof Array))
		options.slugs = [options.slugs];

	if (options.tags !== undefined && ! (options.tags instanceof Array))
		options.tags = [options.tags];

	// Make sure there is an invalid ID in the id list if it is empty
	// Since the most logical thing to do is replying with an empty set
	if (options.ids instanceof Array && options.ids.length === 0)
		options.ids.push(- 1);

	if (options.limit === undefined)
		options.limit = 10;

	// Make sure the database tables exists before going further!
	if ( ! dbChecked) {
		log.debug('larvitblog: getEntries() - Database not checked, rerunning this method when event have been emitted.');
		eventEmitter.on('checked', function() {
			log.debug('larvitblog: getEntries() - Database check event received, rerunning getEntries().');
			getEntries(options, cb);
		});

		return;
	}

	sql  = 'SELECT ed.*, e.id, e.created, e.published, GROUP_CONCAT(t.content) AS tags, GROUP_CONCAT(i.uri) AS images\n';
	sql += 'FROM blog_entries e\n';
	sql += '	LEFT JOIN blog_entriesData       ed ON ed.entryId = e.id\n';
	sql += '	LEFT JOIN blog_entriesDataTags   t  ON t.entryId  = e.id AND t.lang = ed.lang\n';
	sql += '	LEFT JOIN blog_entriesDataImages i  ON i.entryId  = e.id\n';
	sql += 'WHERE 1 + 1\n';

	// Only get post contents with selected languages
	if (options.langs !== undefined) {
		sql += '	AND ed.lang IN (';

		i = 0;
		while (options.langs[i] !== undefined) {
			sql += '?,';
			dbFields.push(options.langs[i]);

			i ++;
		}

		sql = sql.substring(0, sql.length - 1) + ')\n';
	}

	// Only get posts with the current slugs
	if (options.slugs !== undefined) {
		sql += '	AND e.id IN (SELECT entryId FROM blog_entriesData WHERE slug IN (';

		i = 0;
		while (options.slugs[i] !== undefined) {
			sql += '?,';
			dbFields.push(options.slugs[i]);

			i ++;
		}

		sql = sql.substring(0, sql.length - 1) + '))\n';
	}

	// Only get post contents with selected tags
	if (options.tags !== undefined) {
		sql += '	AND e.id IN (SELECT entryId FROM blog_entriesDataTags WHERE content IN (';

		i = 0;
		while (options.tags[i] !== undefined) {
			sql += '?,';
			dbFields.push(options.tags[i]);

			i ++;
		}

		sql = sql.substring(0, sql.length - 1) + '))\n';
	}

	// Only get posts with given ids
	if (options.ids !== undefined) {
		sql += '	AND e.id IN (';

		i = 0;
		while (options.ids[i] !== undefined) {
			sql += '?,';
			dbFields.push(options.ids[i]);

			i ++;
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

	sql += 'GROUP BY e.id, ed.lang\n';
	sql += 'ORDER BY e.published DESC, ed.lang\n';
	sql += 'LIMIT ' + parseInt(options.limit) + '\n';

	if (options.offset !== undefined)
		sql += ' OFFSET ' + parseInt(options.offset);

	db.query(sql, dbFields, function(err, rows) {
		var entryId,
		    i;

		if (err) {
			cb(err);
			return;
		}

		i = 0;
		while (rows[i] !== undefined) {
			if (tmpEntries[rows[i].id] === undefined) {
				tmpEntries[rows[i].id] = {
					'id': rows[i].id,
					'created': rows[i].created,
					'published': rows[i].published,
					'langs': {}
				};
			}

			tmpEntries[rows[i].id].langs[rows[i].lang] = {
				'header':  rows[i].header,
				'summary': rows[i].summary,
				'body':    rows[i].body,
				'slug':    rows[i].slug,
				'tags':    rows[i].tags,
				'images':  rows[i].images
			};

			i ++;
		}

		for (entryId in tmpEntries) {
			entries.push(tmpEntries[entryId]);
		}

		// Make sure sorting is right
		entries.sort(function(a, b) {
			if (a.published > b.published)
				return - 1;
			if (a.published < b.published)
				return 1;
			return 0;
		});

		cb(null, entries);
	});
};

function getTags(cb) {
	var sql = 'SELECT COUNT(entryId) AS posts, lang, content FROM blog_entriesDataTags GROUP BY lang, content ORDER BY lang, COUNT(entryId) DESC;';

	db.query(sql, function(err, rows) {
		var tags = {'langs': {}},
		    i;

		if (err) {
			cb(err);
			return;
		}

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

function rmEntry(id, cb) {
	var tasks = [];

	// Make sure the database tables exists before going further!
	if ( ! dbChecked) {
		log.debug('larvitblog: rmEntry() - Database not checked, rerunning this method when event have been emitted.');
		eventEmitter.on('checked', function() {
			log.debug('larvitblog: rmEntry() - Database check event received, rerunning rmEntry().');
			exports.rmEntry(id, cb);
		});

		return;
	}

	tasks.push(function(cb) {
		db.query('DELETE FROM blog_entriesDataTags WHERE entryId = ?', [id], cb);
	});

	tasks.push(function(cb) {
		db.query('DELETE FROM blog_entriesDataImages WHERE entryId = ?', [id], cb);
	});

	tasks.push(function(cb) {
		db.query('DELETE FROM blog_entriesData WHERE entryId = ?', [id], cb);
	});

	tasks.push(function(cb) {
		db.query('DELETE FROM blog_entries WHERE id = ?', [id], cb);
	});

	async.series(tasks, cb);
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
		eventEmitter.on('checked', function() {
			log.debug('larvitblog: saveEntry() - Database check event received, rerunning saveEntry().');
			exports.saveEntry(data, cb);
		});

		return;
	}

	// Create a new post id is not set
	if (data.id === undefined) {
		tasks.push(function(cb) {
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

			db.query(sql, dbFields, function(err, result) {
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
		tasks.push(function(cb) {
			db.query('DELETE FROM blog_entriesData WHERE entryId = ?', [parseInt(data.id)], cb);
		});

		// Set published
		if (data.published !== undefined) {
			tasks.push(function(cb) {
				var sql      = 'UPDATE blog_entries SET published = ? WHERE id = ?',
				    dbFields = [data.published, data.id];

				db.query(sql, dbFields, cb);
			});
		}
	}

	// We need to declare this outside the loop because of async operations
	function addEntryData(lang, header, summary, body, slug) {
		tasks.push(function(cb) {
			var sql      = 'INSERT INTO blog_entriesData (entryId, lang, header, summary, body, slug) VALUES(?,?,?,?,?,?);',
			    dbFields = [data.id, lang, header, summary, body, slug];

			db.query(sql, dbFields, cb);
		});
	}

	function addTagData(lang, content) {
		tasks.push(function(cb) {
			var sql      = 'INSERT INTO blog_entriesDataTags (entryId, lang, content) VALUES(?,?,?);',
			    dbFields = [data.id, lang, content];

			db.query(sql, dbFields, cb);
		});
	}

	// Add content data
	if (data.langs) {
		tasks.push(function(cb) {
			db.query('DELETE FROM blog_entriesDataTags WHERE entryId = ?', [data.id], cb);
		});

		for (lang in data.langs) {
			if (data.langs[lang].slug)
				data.langs[lang].slug = slugify(data.langs[lang].slug, {'save': '/'});

			if (data.langs[lang].header || data.langs[lang].body || data.langs[lang].summary) {
				addEntryData(lang, data.langs[lang].header, data.langs[lang].summary, data.langs[lang].body, data.langs[lang].slug);

				if (data.langs[lang].tags) {
					_.each(data.langs[lang].tags.split(','), function(tagContent) {
						addTagData(lang, _.trim(tagContent));
					});
				}
			}
		}
	}

	async.series(tasks, function(err) {
		if (err) {
			cb(err);
			return;
		}

		// Re-read this entry from the database to be sure to get the right deal!
		getEntries({'ids': data.id}, function(err, entries) {
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