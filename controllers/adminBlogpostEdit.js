'use strict';

var blog = require('larvitblog');

exports.run = function(req, res, callback) {
	var data    = {'global': res.globalData},
	    entryId = res.globalData.urlParsed.query.id;

	// Make sure the user have the correct rights
	// This is set in larvitadmingui controllerGlobal
	if ( ! res.adminRights) {
		callback(new Error('Invalid rights'), req, res, {});
		return;
	}

	if (entryId !== undefined) {
		blog.getEntries({'ids': entryId}, function(err, rows) {
			res.globalData.formFields = rows[0];
			callback(null, req, res, data);
		});
	} else {
		callback(null, req, res, data);
	}
};