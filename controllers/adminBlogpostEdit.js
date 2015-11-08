'use strict';

var moment = require('moment'),
    async  = require('async'),
    blog   = require('larvitblog');

exports.run = function(req, res, callback) {
	var data    = {'global': res.globalData},
	    entryId = res.globalData.urlParsed.query.id,
	    tasks   = [];

	// Make sure the user have the correct rights
	// This is set in larvitadmingui controllerGlobal
	if ( ! res.adminRights) {
		callback(new Error('Invalid rights'), req, res, {});
		return;
	}

	// Save a POSTed form
	if (res.globalData.formFields.save !== undefined) {
		tasks.push(function(cb) {
			var saveObj = {'langs': {}},
			    fieldName,
			    field,
			    lang;

			if (entryId !== undefined)
				saveObj.id = entryId;

			if (res.globalData.formFields.published) {
				try {
					saveObj.published = moment(res.globalData.formFields.published).toDate();
				} catch (err) {
					log.warn('larvitblog: controllers/adminBlogpostEdit.js - Wrong published format, defaulting to now');
					saveObj.published = moment().toDate();
				}
			} else {
				saveObj.published = null;
			}

			for (field in res.globalData.formFields) {
				if (field.split('.').length === 2) {
					fieldName = field.split('.')[0];
					lang      = field.split('.')[1];

					if (saveObj.langs[lang] === undefined)
						saveObj.langs[lang] = {};

					if ( ! res.globalData.formFields[field])
						saveObj.langs[lang][fieldName] = null;
					else
						saveObj.langs[lang][fieldName] = res.globalData.formFields[field];
				}
			}

			blog.saveEntry(saveObj, function(err, entry) {
				if (err) {
					cb(err);
					return;
				}

				// Redirect to a new URL if a new entryId was created
				if ( ! entryId) {
					res.statusCode = 302;
					res.setHeader('Location', '/adminBlogpostEdit?id=' + entry.id + '&langs=' + res.globalData.urlParsed.query.langs);
					entryId = entry.id;
				}
				cb();
			});
		});
	}

	// Delete an entry
	if (res.globalData.formFields.delete !== undefined && entryId !== undefined) {
		tasks.push(function(cb) {
			blog.rmEntry(entryId, function(err) {
				if (err) {
					cb(err);
					return;
				}

				res.statusCode = 302;
				res.setHeader('Location', '/adminBlogposts');
				cb();
			});
		});
	}

	// Load data from database
	else if (entryId !== undefined) {
		tasks.push(function(cb) {
			blog.getEntries({'ids': entryId}, function(err, rows) {
				var lang;

				if (rows[0] !== undefined) {
					res.globalData.formFields = {
						'created': rows[0].created,
						'published': rows[0].published,
					};

					for (lang in rows[0].langs) {
						res.globalData.formFields['header.' + lang] = rows[0].langs[lang].header;
						res.globalData.formFields['slug.'   + lang] = rows[0].langs[lang].slug;
						res.globalData.formFields['body.'   + lang] = rows[0].langs[lang].body;
					}
				} else {
					cb(new Error('larvitblog: controllers/adminBlogpostEdit.js - Wrong entryId supplied'));
					return;
				}

				cb();
			});
		});
	}

	async.series(tasks, function(err) {
		callback(err, req, res, data);
	});
};