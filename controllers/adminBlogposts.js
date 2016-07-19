'use strict';

var blog = require('larvitblog');

exports.run = function(req, res, callback) {
	var data = {'global': res.globalData};

	// Make sure the user have the correct rights
	// This is set in larvitadmingui controllerGlobal
	if ( ! res.adminRights) {
		callback(new Error('Invalid rights'), req, res, {});
		return;
	}

	if (res.langs)
		data.global.langs = res.langs;

	blog.getEntries(function(err, rows) {
		data.blogEntries = rows;
		callback(null, req, res, data);
	});
};
