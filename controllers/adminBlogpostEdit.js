'use strict';

const slugify = require('larvitslugify'),
	moment  = require('moment'),
	imgLib  = require('larvitimages'),
	async   = require('async'),
	blog    = require('larvitblog'),
	db      = require('larvitdb'),
	_       = require('lodash'),
	uuidLib	= require('uuid'),
	lUtils	= require('larvitutils');

exports.run = function (req, res, callback) {
	const data    = {'global': res.globalData},
	    entryUuid = res.globalData.urlParsed.query.uuid || uuidLib.v1(),
	    tasks   = [],
		postImages	= [];

	let updatePostImages = false;

	data.global.menuControllerName	= 'adminBlogpostEdit';
	data.global.messages	= [];
	data.global.errors	= [];


	// Make sure the user have the correct rights
	// This is set in larvitadmingui controllerGlobal
	if ( ! res.adminRights) {
		callback(new Error('Invalid rights'), req, res, {});
		return;
	}


	// Save a POSTed form
	if (res.globalData.formFields.save !== undefined) {

		// Load post images in case we need to remove some
		tasks.push(function (cb) {
			const sql = 'SELECT slug,uuid FROM images_images WHERE slug LIKE ?';

			db.query(sql, ['blog_entry_' + entryUuid + '_image_%'], function (err, images) {
				if (err) return cb(err);

				for (const i of images) {
					postImages.push({
						'uuid'	: lUtils.formatUuid(i.uuid),
						'slug'	: i.slug,
						'uri'	: i.slug,
						'number': i.slug.match(/blog_entry_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_image_(\d)\.\w+/)[1]
					});
				}

				cb();
			});
		});

		// Save input data (not images)
		tasks.push(function (cb) {
			const saveObj = {'langs': {}};
			let	fieldName,
			    field,
			    lang;

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

			blog.saveEntry(saveObj, function (err) {
				if (err) {
					cb(err);
					return;
				}

				// Redirect to a new URL if a new entryUuid was created
				if ( ! entryUuid) {
					res.statusCode = 302;
					res.setHeader('Location', '/adminBlogpostEdit?uuid=' + entryUuid + (res.globalData.urlParsed.query.langs === undefined ? '' : '&langs=' + res.globalData.urlParsed.query.langs));
				}
				cb();
			});
		});

		if (req.formFields !== undefined) {
			// Delete the delete-marked ones
			for (const fieldName in req.formFields) {
				if (fieldName.substring(0, 9) === 'rm_image_') {
					updatePostImages = true;
					_(postImages).remove(function (img) { return img.uuid === req.formFields[fieldName]; });

					tasks.push(function (cb) {
						imgLib.rmImage(req.formFields[fieldName], cb);
					});
				}
			}
		}

		// Add new images to post
		if (req.formFiles !== undefined) {
			const newImages = {};

			let fileExt = null;

			for (let i = 1; i < 6; i ++) {
				if (req.formFiles['image' + i] !== undefined && req.formFiles['image' + i].size !== 0) {
					if	(req.formFiles['image' + i].type === 'image/png')  fileExt = 'png';
					else if	(req.formFiles['image' + i].type === 'image/jpeg') fileExt = 'jpg';
					else if	(req.formFiles['image' + i].type === 'image/gif')  fileExt = 'gif';
					else	fileExt = false;

					if (fileExt) {
						const slug = 'blog_entry_' + entryUuid + '_image_' + i + '.' + fileExt;

						newImages[slug] = {
							'slug':	slug,
							'uuid':	uuidLib.v4(),
							'file':	req.formFiles['image' + i],
							'number':	i,
							'uri':	slug
						};

						// postImges contains both new and old images since the images list is cleared and rewritten every time it changes
						postImages.push(newImages[slug]);

						updatePostImages = true;
					}
				}
			}

			for (const img in newImages) {
				tasks.push(function (cb) {
					imgLib.saveImage(newImages[img], cb);
				});
			}
		}

		if (updatePostImages) {
			tasks.push(function (cb) {
				const options = {
					'uuid': entryUuid,
					'images': postImages
				};

				blog.setImages(options, cb);
			});
		}
	}

	// Delete an entry
	if (res.globalData.formFields.delete !== undefined && entryUuid !== undefined) {
		tasks.push(function (cb) {
			blog.rmEntry(entryUuid, function (err) {
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
	else if (data.global.urlParsed.query.uuid !== undefined) {

		let images = null;

		tasks.push(function (cb) {
			blog.getEntries({'uuids': entryUuid}, function (err, rows) {
				var lang;

				if (rows[0] !== undefined) {
					res.globalData.formFields = {
						'created': rows[0].created,
						'published': rows[0].published,
					};

					images = rows[0].images.split(',');

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

		tasks.push(function (cb) {

			if (images === null)  return cb();

			if ( ! Array.isArray(images)) { images = [images]; }

			imgLib.getImages({'slugs': images, 'limit': false}, function (err, dbImages) {
				if (err) {
					cb(err);
					return;
				}

				data.dbImages = [];

				for (const i in dbImages) {
					data.dbImages.push(dbImages[i]);
				}

				cb();
			});
		});
	}

	async.series(tasks, function (err) {
		callback(err, req, res, data);
	});
};
