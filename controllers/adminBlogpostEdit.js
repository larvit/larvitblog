'use strict';

var slugify = require('larvitslugify'),
    moment  = require('moment'),
    imgLib  = require('larvitimages'),
    async   = require('async'),
    blog    = require('larvitblog'),
    db      = require('larvitdb'),
    _       = require('lodash'),
	uuidLib	= require('uuid'),
	lUtils	= require('larvitutils');

exports.run = function(req, res, callback) {
	var data    = {'global': res.globalData},
	    entryUuid = res.globalData.urlParsed.query.uuid,
	    tasks   = [];

	// Make sure the user have the correct rights
	// This is set in larvitadmingui controllerGlobal
	if ( ! res.adminRights) {
		callback(new Error('Invalid rights'), req, res, {});
		return;
	}

	function getDbImages(cb) {
		var slugs = [],
		    i;

		i = 0;
		while (i !== 5) {
			i ++;
			slugs.push('blog_entry' + entryUuid + '_image' + i);
		}

		imgLib.getImages({'slugs': slugs, 'limit': false}, function(err, dbImages) {
			if (err) {
				cb(err);
				return;
			}

			data.dbImages = dbImages;

			cb();
		});
	}

	// Get possible images
	if (entryUuid) {
		tasks.push(getDbImages);
	}

	// Save a POSTed form
	if (res.globalData.formFields.save !== undefined) {

		// Save input data (not images)
		tasks.push(function(cb) {
			var saveObj = {'langs': {}},
			    fieldName,
			    field,
			    lang;

			if (entryUuid !== undefined)
				saveObj.uuid = entryUuid;

			// Define published
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

					if (fieldName === 'slug') {
						res.globalData.formFields[field] = _.trimEnd(res.globalData.formFields[field], '/');

						// Auto generate slug if it is not set
						if (res.globalData.formFields[field] === '' && saveObj.published !== null && res.globalData.formFields['header.' + lang] !== '') {
							res.globalData.formFields[field] = moment(saveObj.published).format('YYYY-MM-DD_') + slugify(res.globalData.formFields['header.' + lang], '-');
						}
					}

					if ( ! res.globalData.formFields[field]) {
						saveObj.langs[lang][fieldName] = null;
					} else {
						saveObj.langs[lang][fieldName] = res.globalData.formFields[field];
					}
				}
			}

			blog.saveEntry(saveObj, function(err, entry) {
				if (err) {
					cb(err);
					return;
				}

				// Redirect to a new URL if a new entryUuid was created
				if ( ! entryUuid) {
					res.statusCode = 302;
					res.setHeader('Location', '/adminBlogpostEdit?id=' + entry.id + '&langs=' + res.globalData.urlParsed.query.langs);
					entryUuid = entry.uuid;
				}
				cb();
			});
		});

		// Save images
		tasks.push(function(cb) {
			var newImages = {},
			    tasks     = [],
			    fieldName,
			    fileExt,
			    slug,
			    i;

			if (req.formFiles !== undefined) {
				i = 0;
				while (i !== 5) {
					i ++;

					if (req.formFiles['image' + i] !== undefined && req.formFiles['image' + i].size !== 0) {
						     if (req.formFiles['image' + i].type === 'image/png')  fileExt = 'png';
						else if (req.formFiles['image' + i].type === 'image/jpeg') fileExt = 'jpg';
						else if (req.formFiles['image' + i].type === 'image/gif')  fileExt = 'gif';
						else                                                       fileExt = false;

						if (fileExt) {
							slug = 'blog_entry' + entryUuid + '_image' + i + '.' + fileExt;

							newImages[slug] = {
								'slug':         slug,
								'uploadedFile': req.formFiles['image' + i]
							};

							_.each(data.dbImages, function(img) {
								if (img.slug.substring(0, img.slug.length - 4) === slug.substring(0, slug.length - 4)) {
									newImages[slug].id = img.id;
								}
							});
						}
					}
				}

				function saveImg(slug) {
					tasks.push(function(cb) {
						var imgNr = parseInt(slug.split('_')[2].substring(5));

						imgLib.saveImage(newImages[slug], function(err) {
							if (err) {
								cb(err);
								return;
							}

							db.query('DELETE FROM blog_entriesDataImages WHERE entryUuid = ? AND imgNr = ?', [lUtils.uuidToBuffer(entryUuid), imgNr], function(err) {
								if (err) {
									cb(err);
									return;
								}

								db.query('INSERT INTO blog_entriesDataImages (entryUuid, imgNr, uri) VALUES(?, ?, ?);', [lUtils.uuidToBuffer(entryUuid), imgNr, slug], cb);
							});
						});
					});
				}

				// Save the new ones
				for (slug in newImages) {
					saveImg(slug);
				}

				function addRmTask(imgNr) {
					tasks.push(function(cb) {
						imgLib.getImages({'slugs': 'blog_entry' + entryUuid + '_image' + imgNr}, function(err, images) {
							if (err) {
								cb(err);
								return;
							}

							if (images.length) {
								imgLib.rmImage(images[0].id, cb);
								return;
							}

							cb();
						});
					});

					tasks.push(function(cb) {
						db.query('DELETE FROM blog_entriesDataImages WHERE entryUuid = ? AND imgNr = ?', [lUtils.uuidToBuffer(entryUuid), imgNr], cb);
					});
				}

				// Delete the delete-marked ones
				for (fieldName in req.formFields) {
					if (fieldName.substring(0, 9) === 'rm_image_') {
						addRmTask(fieldName.split('_')[2]);
					}
				}

				// Re-read images from database
				tasks.push(getDbImages);

				async.series(tasks, cb);
			}
		});
	}

	// Delete an entry
	if (res.globalData.formFields.delete !== undefined && entryUuid !== undefined) {
		tasks.push(function(cb) {
			blog.rmEntry(entryUuid, function(err) {
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
	else if (entryUuid !== undefined) {
		tasks.push(function(cb) {
			blog.getEntries({'uuid': entryUuid}, function(err, rows) {
				var lang;

				if (rows[0] !== undefined) {
					res.globalData.formFields = {
						'created': rows[0].created,
						'published': rows[0].published,
					};

					for (lang in rows[0].langs) {
						res.globalData.formFields['header.'  + lang] = rows[0].langs[lang].header;
						res.globalData.formFields['slug.'    + lang] = rows[0].langs[lang].slug;
						res.globalData.formFields['summary.' + lang] = rows[0].langs[lang].summary;
						res.globalData.formFields['body.'    + lang] = rows[0].langs[lang].body;
						res.globalData.formFields['tags.'    + lang] = rows[0].langs[lang].tags;
					}
				} else {
					cb(new Error('larvitblog: controllers/adminBlogpostEdit.js - Wrong uuid supplied'));
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
