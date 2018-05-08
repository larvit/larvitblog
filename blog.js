'use strict';

const	topLogPrefix	= 'larvitblog: blog.js: ',
	dataWriter	= require(__dirname + '/dataWriter.js'),
	lUtils	= require('larvitutils'),
	log	= require('winston'),
	db	= require('larvitdb');

/**
 * Get blog entries
 *
 * @param obj options -	{	// All options are optional!
 *		'langs': ['sv', 'en'],
 *		'slugs': ['blu', 'bla'],
 *		'publishedAfter': dateObj,
 *		'publishedBefore': dateObj,
 *		'tags': ['dks', 'ccc'],
 *		'uuids': ['c7a5a178-394c-11e7-a919-92ebcb67fe33', 'cba7d0b6-394c-11e7-a919-92ebcb67fe33'],
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

	if (options.publishedAfter && ! options.publishedAfter instanceof Date) {
		const err = new Error('Invalid date format, publishedAfter is not an instance of Date');
		log.verbose(logPrefix + err.message);
		return cb(err);
	}

	if (options.publishedBefore && ! options.publishedBefore instanceof Date) {
		const err = new Error('Invalid date format, publishedBefore is not an instance of Date');
		log.verbose(logPrefix + err.message);
		return cb(err);
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
			const buffer = lUtils.uuidToBuffer(options.uuids[i]);

			if (buffer === false) {
				const e = new Error('Invalid blog uuid');
				log.warn(logPrefix + e.message);
				return cb(e);
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
		let	tags	= {'langs': {}},
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

	dataWriter.intercom.send(message, options, function (err, msgUuid) {
		if (err) return cb(err);

		dataWriter.emitter.once(msgUuid, cb);
	});
}

function rmImage(options, cb) {
	const	message	= {};

	message.action	= 'rmImage';
	message.params	= {};
	message.params.uuid	= options.uuid;
	message.params.imgNr	= options.imgNr;

	dataWriter.intercom.send(message, {'exchange': dataWriter.exchangeName}, function (err, msgUuid) {
		if (err) return cb(err);

		dataWriter.emitter.once(msgUuid, cb);
	});
}

/**
 * Save an entry
 *
 * @param obj data - { // All options are optional!
 *                     'uuid': '1323-adf234234-a23423-sdfa-232',
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
	const	options	= {'exchange': dataWriter.exchangeName},
		message	= {};

	message.action	= 'saveEntry';
	message.params	= {};

	message.params.data = data;

	dataWriter.intercom.send(message, options, function (err, msgUuid) {
		if (err) return cb(err);

		dataWriter.emitter.once(msgUuid, cb);
	});
}

/**
 * Sets images on an entry. Existing images on entry will be deleted so make sure to
 * supply existing image if you want to keep em on the entry.
 *
 * @param obj data -	{
 * 							'uuid': '1323-adf234234-a23423-sdfa-232', // uuid of blog post in question
 * 							'images': [{'number': 1, 'uri': 'someUri.png'}] // array with objects containing image number and uri to image
 * 						}
 * @param func cb(err) - regular ol' callback
 */
function setImages(data, cb) {
	const	options	= {'exchange': dataWriter.exchangeName},
		message	= {};

	message.action	= 'setImages';
	message.params	= {};

	message.params.data = data;

	dataWriter.intercom.send(message, options, function (err, msgUuid) {
		if (err) return cb(err);

		dataWriter.emitter.once(msgUuid, cb);
	});
};

function search(options, cb) {
	const logPrefix = topLogPrefix + 'search() - ',
		dbFields	= [];

	let sql = 'SELECT entryUuid FROM blog_entriesData WHERE MATCH (header,body,summary) AGAINST (? IN NATURAL LANGUAGE MODE) AND entryUuid IN (SELECT uuid FROM blog_entries WHERE published <= NOW())';

	if (typeof options === 'string') {
		dbFields.push(options);
	} else {
		dbFields.push(options.searchText);
	}

	if (options.tags && options.tags.length > 0) {
		if ( ! Array.isArray(options.tags)) options.tags = [options.tags];

		for (const t of options.tags) {
			sql += ' AND entryUuid IN (SELECT DISTINCT entryUuid FROM blog_entriesDataTags WHERE content = ?)';
			dbFields.push(t);
		}
	}

	db.query(sql, dbFields, function (err, rows) {
		const result = [];

		if (err) {
			log.warn(logPrefix + 'search failed: ' + err.message);
			cb(err);
		}

		for (const row of rows) {
			result.push(lUtils.formatUuid(row.entryUuid));
		}

		cb(null, result);
	});
}

exports.getEntries = getEntries;
exports.getTags    = getTags;
exports.options	= dataWriter.options;
exports.rmEntry    = rmEntry;
exports.rmImage	= rmImage;
exports.saveEntry  = saveEntry;
exports.setImages	= setImages;
exports.dataWriter	= dataWriter;
exports.search	= search;