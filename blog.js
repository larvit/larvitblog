'use strict';

var db           = require('larvitdb'),
    log          = require('winston'),
    events       = require('events'),
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

		sql = 'CREATE TABLE IF NOT EXISTS `blog_entriesData` (`entryId` int(10) unsigned NOT NULL, `lang` char(2) CHARACTER SET ascii NOT NULL, `header` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL, `body` text COLLATE utf8mb4_unicode_ci NOT NULL, `slug` varchar(255) CHARACTER SET ascii NOT NULL, PRIMARY KEY (`entryId`,`lang`), UNIQUE KEY `lang_slug` (`lang`,`slug`), CONSTRAINT `blog_entriesData_ibfk_1` FOREIGN KEY (`entryId`) REFERENCES `blog_entries` (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;';
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
createTablesIfNotExists();

/**
 * Get blog entries
 *
 * @param obj options - { // All options are optional!
 *                        'langs': ['sv', 'en'],
 *                        'publishedAfter': dateObj,
 *                        'ids': [32,4],
 *                        'limit': 10,
 *                        'offset': 20
 *                      }
 * @param func cb - callback(err, entries)
 */
exports.getEntries = function(options, cb) {
	var tmpEntries = {},
	    dbFields   = [],
	    entries    = [],
	    sql,
	    i;

	if (typeof options === 'function') {
		cb      = options;
		options = {};
	}

	if (options.langs !== undefined && ! options.langs instanceof Array)
		options.langs = [langs];

	if (options.ids !== undefined && ! options.ids instanceof Array)
		options.ids = [ids];

	if (options.limit === undefined)
		options.limit = 10;

	// Make sure the database tables exists before going further!
	if ( ! dbChecked) {
		log.debug('larvitblog: getEntries() - Database not checked, rerunning this method when event have been emitted.');
		eventEmitter.on('checked', function() {
			log.debug('larvitblog: getEntries() - Database check event received, rerunning getEntries().');
			exports.getEntries(options, cb);
		});

		return;
	}

	sql  = 'SELECT ed.*, e.created\n';
	sql += 'FROM blog_entriesData ed\n';
	sql += '	JOIN blog_entries e ON e.id = ed.entryId\n';
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
			if (tmpEntries[rows[i].entryId] === undefined) {
				tmpEntries[rows[i].entryId] = {
					'id': rows[i].entryId,
					'created': rows[i].created,
					'langs': {}
				};
			}

			tmpEntries[rows[i].entryId].langs[rows[i].lang] = {
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