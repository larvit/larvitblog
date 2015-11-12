'use strict';

var db           = require('larvitdb'),
    log          = require('winston'),
    async        = require('async'),
    events       = require('events'),
    slugify      = require('underscore.string/slugify'),
    eventEmitter = new events.EventEmitter(),
    dbChecked    = false;

// Create database tables if they are missing
function createTablesIfNotExists(cb) {
	var sql;

	sql = 'CREATE TABLE IF NOT EXISTS `blog_entries` (`id` int(10) unsigned NOT NULL AUTO_INCREMENT, `created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, `published` datetime DEFAULT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8;';
	db.query(sql, function(err) {
		if (err) {
			cb(err);
			return;
		}

		sql = 'CREATE TABLE IF NOT EXISTS `blog_entriesData` (`entryId` int(10) unsigned NOT NULL, `lang` char(2) CHARACTER SET ascii NOT NULL, `header` varchar(191) COLLATE utf8mb4_unicode_ci, `body` text COLLATE utf8mb4_unicode_ci, `slug` varchar(255) CHARACTER SET ascii, PRIMARY KEY (`entryId`,`lang`), UNIQUE KEY `lang_slug` (`lang`,`slug`), CONSTRAINT `blog_entriesData_ibfk_1` FOREIGN KEY (`entryId`) REFERENCES `blog_entries` (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;';
		db.query(sql, function(err) {
			if (err) {
				cb(err);
				return;
			}

			dbChecked = true;
			eventEmitter.emit('checked');
		});
	});
}
createTablesIfNotExists(function(err) {
	log.error('larvitblog: createTablesIfNotExists() - Database error: ' + err.message);
});

/**
 * Get blog entries
 *
 * @param obj options - { // All options are optional!
 *                        'langs': ['sv', 'en'],
 *                        'slugs': ['blu', 'bla'],
 *                        'publishedAfter': dateObj,
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

	sql  = 'SELECT ed.*, e.id, e.created, e.published\n';
	sql += 'FROM blog_entries e\n';
	sql += '	LEFT JOIN blog_entriesData ed ON ed.entryId = e.id\n';
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

		sql = sql.substring(0, sql.length - 1) + ')\n';
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
		sql += '	AND e.published < ?\n';
		dbFields.push(options.publishedAfter);
	}

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
				'header': rows[i].header,
				'body': rows[i].body,
				'slug': rows[i].slug
			};

			i ++;
		}

		for (entryId in tmpEntries) {
			entries.push(tmpEntries[entryId]);
		}

		cb(null, entries);
	});
};

function rmEntry(id, cb) {
	db.query('DELETE FROM blog_entriesData WHERE entryId = ?', [id], function(err) {
		if (err) {
			cb(err);
			return;
		}

		db.query('DELETE FROM blog_entries WHERE id = ?', [id], cb);
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
 *                         'body': 'lots of foo and bars'
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
	function addEntryData(lang, header, body, slug) {
		tasks.push(function(cb) {
			var sql      = 'INSERT INTO blog_entriesData (entryId, lang, header, body, slug) VALUES(?,?,?,?,?);',
			    dbFields = [data.id, lang, header, body, slug];

			db.query(sql, dbFields, cb);
		});
	}

	// Add content data
	if (data.langs) {
		for (lang in data.langs) {
			if (data.langs[lang].slug)
				data.langs[lang].slug = slugify(data.langs[lang].slug);

			if (data.langs[lang].header || data.langs[lang].body)
				addEntryData(lang, data.langs[lang].header, data.langs[lang].body, data.langs[lang].slug);
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
exports.rmEntry    = rmEntry;
exports.saveEntry  = saveEntry;