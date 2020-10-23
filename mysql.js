const mysqlClient = require("mysql");

let mysql = {};

mysql.pool = null;
/**
 *  mysql.createPool({
 *     host: 'localhost',
 *     port: "3306",
 *     user: 'root',
 *     password: 'password',
 *     database: 'tedt'
 * })
 */
mysql.createPool = function(opts) {
	
	this.pool = mysqlClient.createPool(opts);
};

mysql.query = function(sql, args, callback) {
	if (this.pool) {
		let self = this;
		return new Promise(function(resolve, reject) {
			self.pool.getConnection(function(err, connection) {
				if (err) {
					callback ? callback(err, null) : reject(err);
					return;
				}
				connection.query(sql, args, function(err, results) {
					connection.release();
					if (err) {
						callback ? callback(err, null) : reject(err);
						return;
					}

					callback ? callback(false, results) : resolve(results);
				});
			});
		});

	} else {
		throw new Error("未成功配置连接池");
	}

};

mysql.begin = function(callback) {
	if (this.pool) {
		let self = this;
		return new Promise(function(resolve, reject) {
			self.pool.getConnection(function(err, connection) {
				if (err) {
					callback ? callback(err, null) : reject(err);
					return;
				}
				connection.beginTransaction(function(err) {
					if (err) {
						callback ? callback(err, null) : reject(err);
						return;
					}

					var trans = function(connection) {

						return {
							commit: function(callback) {
								return new Promise(function(resolve, reject) {
									connection.commit(function(err, results) {
										if (err) {
											return connection.rollback(function() {
												connection.release();
												callback ? callback(err, null) : reject(err);
											});
										}

										connection.release();
										callback ? callback(null, results) : resolve(results);
									});
								});
							},
							rollback: function(callback) {
								return new Promise(function(resolve, reject) {
									connection.rollback(function(err) {
										connection.release();
										if (err) callback ? callback(err, null) : reject(err);
										else callback ? callback(null, null) : resolve(err);
									});
								});

							},
							query: function(sql, args, callback) {
								return new Promise(function(resolve, reject) {
									connection.query(sql, args, function(err, results) {
										if (err) {
											return connection.rollback(function() {
												connection.release();
												callback ? callback(err, null) : reject(err);
											});
										}

										callback ? callback(null, results) : resolve(results);
									});
								});
							}
						};
					};

					callback ? callback(null, trans(connection)) : resolve(trans(connection));
				});
			});
		});
	} else {
		throw new Error("未成功配置连接池");
	}
};


module.exports = mysql;
