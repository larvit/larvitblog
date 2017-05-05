'use strict';

const	uuidLib	= require('uuid'),
	lUtils	= require('larvitutils'),
	async	= require('async'),
	db	= require('larvitdb');

exports = module.exports = function (cb) {
	const tasks = [];

	db.query('SELECT id FROM blog_entries WHERE uuid IS NULL', function (err, rows) {
		if (err) return cb(err);

		for (const r of rows) {
			const uuid = lUtils.uuidToBuffer(uuidLib.v1());

			tasks.push(function (cb) {
				db.query('UPDATE blog_entries SET uuid = ? WHERE id = ?', [uuid, r.id], cb);
			});

			tasks.push(function (cb) {
				db.query('UPDATE blog_entriesData SET entryUuid = ? WHERE entryId = ?', [uuid, r.id], cb);
			});

			tasks.push(function (cb) {
				db.query('UPDATE blog_entriesDataImages SET entryUuid = ? WHERE entryId = ?', [uuid, r.id], cb);
			});

			tasks.push(function (cb) {
				db.query('UPDATE blog_entriesDataTags SET entryUuid = ? WHERE entryId = ?', [uuid, r.id], cb);
			});
		}

		async.series(tasks, cb);
	});
};