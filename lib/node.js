'use strict';

require('./utils/logger.js');

const os = require('os');
const Web3 = require('web3');
let web3;
const async = require('async');
const _ = require('lodash');
const debounce = require('debounce');
const pjson = require('./../package.json');
const chalk = require('chalk');
const axios = require('axios');

let Primus = require('primus'),
	Emitter = require('primus-emit'),
	Latency = require('primus-spark-latency'),
	Socket, socket;

const INSTANCE_NAME = process.env.INSTANCE_NAME;
const WS_SECRET = process.env.WS_SECRET || "metermonitorsecret";

const MAX_BLOCKS_HISTORY = 60;
const UPDATE_INTERVAL = 5000;
const PING_INTERVAL = 30000;
const MAX_HISTORY_UPDATE = 5000;
const MAX_CONNECTION_ATTEMPTS = 500000;
const CONNECTION_ATTEMPTS_TIMEOUT = 10000000;

Socket = Primus.createSocket({
	transformer: 'websockets',
	pathname: '/api',
	timeout: 120000,
	strategy: 'disconnect,online,timeout',
	reconnect: {
		retries: 1000000000000,
		min: 150,
		max: 150
	},
	plugin: {emitter: Emitter, sparkLatency: Latency}
});

if (process.env.NODE_ENV === 'production' && INSTANCE_NAME === "") {
	console.error("No instance name specified!");
	process.exit(1);
}

console.info('   ');
console.info('   ', 'METER NET STATS CLIENT');
console.success('   ', 'v' + pjson.version);
console.info('   ', 'connected to node ' + process.env.RPC_HOST)
console.info('   ');
console.info('   ');

function Node() {
	this.info = {
		name: INSTANCE_NAME || (process.env.EC2_INSTANCE_ID || os.hostname()),
		contact: (process.env.CONTACT_DETAILS || ""),
		coinbase: null,
		node: null,
		net: null,
		protocol: null,
		api: null,
		port: 30303,
		os: os.platform(),
		os_v: os.release(),
		client: pjson.version,
		canUpdateHistory: true,
	};

	this.id = _.camelCase(this.info.name);

	this.stats = {
		active: false,
		mining: false,
		hashrate: 0,
		peers: 0,
		pending: 0,
		gasPrice: 0,
		block: {
			number: 0,
			hash: '?',
			difficulty: 0,
			totalDifficulty: 0,
			gasLimit: 8000000,
			transactions: [],
			uncles: []
		},
		syncing: false,
		uptime: 0
	};

	this._lastBlock = 0;
	this._lastStats = JSON.stringify(this.stats);
	this._lastFetch = 0;
	this._lastPending = 0;

	this._tries = 0;
	this._down = 0;
	this._latency = 0;

	this._web3 = false;
	this._socket = false;

	this._latestQueue = null;
	this.pendingFilter = false;
	this.chainFilter = false;
	this.updateInterval = false;
	this.pingInterval = false;
	this.connectionInterval = false;

	this._lastBlockSentAt = 0;
	this._lastChainLog = 0;
	this._lastPendingLog = 0;
	this._chainDebouncer = 0;
	this._chan_min_time = 50;
	this._max_chain_debouncer = 20;
	this._chain_debouncer_cnt = 0;
	this._connection_attempts = 0;
	this._timeOffset = null;

	this.startWeb3Connection();

	return this;
}

Node.prototype.startWeb3Connection = function () {
	console.info('Starting web3 connection');

	web3 = new Web3();
	web3.setProvider(new web3.providers.HttpProvider('http://' + (process.env.RPC_HOST || 'localhost') + ':8545'));

	this.checkWeb3Connection();
}

Node.prototype.checkWeb3Connection = function () {
	let self = this;

	if (!this._web3) {
		if (web3.isConnected()) {
			console.success('Web3 connection established');

			this._web3 = true;
			this.init();

			return true;
		} else {
			if (this._connection_attempts < MAX_CONNECTION_ATTEMPTS) {
				console.error('Web3 connection attempt', chalk.cyan('#' + this._connection_attempts++), 'failed');
				console.error('Trying again in', chalk.cyan(500 * this._connection_attempts + ' ms'));

				setTimeout(function () {
					self.checkWeb3Connection();
				}, CONNECTION_ATTEMPTS_TIMEOUT * this._connection_attempts);
			} else {
				console.error('Web3 connection failed', chalk.cyan(MAX_CONNECTION_ATTEMPTS), 'times. Aborting...');
			}
		}
	}
}

Node.prototype.reconnectWeb3 = function () {
	console.warn("Uninstalling filters and update interval");

	this._web3 = false;
	this._connection_attempts = 0;

	if (this.updateInterval)
		clearInterval(this.updateInterval);

	try {
		web3.reset(true);
	} catch (err) {
		console.error("Web3 reset error:", err);
	}

	console.info("Web3 reconnect attempts started");

	this.checkWeb3Connection();
}

Node.prototype.startSocketConnection = function () {
	if (!this._socket) {
		console.info('wsc', 'Starting socket connection');

		socket = new Socket(process.env.WS_SERVER || 'ws://meter-stats-server.nextblu.com:3030');

		this.setupSockets();
	}
}

Node.prototype.setupSockets = function () {
	let self = this;

	// Setup events
	socket.on('open', function open() {
		console.info('wsc', 'The socket connection has been opened.');
		console.info('   ', 'Trying to login');

		self.getInfo();

		socket.emit('hello', {
			id: self.id,
			info: self.info,
			secret: WS_SECRET
		});
	})
		.on('ready', function () {
			self._socket = true;
			console.success('wsc', 'The socket connection has been established.');

			self.getLatestBlock();
			self.getPending();
			self.getStats(true);
		})
		.on('data', function incoming(data) {
			console.stats('Socket received some data', data);
		})
		.on('history', function (data) {
			console.stats('his', 'Got history request');

			self.getHistory(data);
		})
		.on('node-pong', function (data) {
			var now = _.now();
			var latency = Math.ceil((now - data.clientTime) / 2);

			socket.emit('latency', {
				id: self.id,
				latency: latency
			});
		})
		.on('end', function end() {
			self._socket = false;
			console.error('wsc', 'Socket connection end received');
		})
		.on('error', function error(err) {
			console.error('wsc', 'Socket error:', err);
		})
		.on('timeout', function () {
			self._socket = false;
			console.error('wsc', 'Socket connection timeout');
		})
		.on('close', function () {
			self._socket = false;
			console.error('wsc', 'Socket connection has been closed');
		})
		.on('offline', function () {
			self._socket = false;
			console.error('wsc', 'Network connection is offline');
		})
		.on('online', function () {
			self._socket = true;
			console.info('wsc', 'Network connection is online');
		})
		.on('reconnect', function () {
			console.info('wsc', 'Socket reconnect attempt started');
		})
		.on('reconnect scheduled', function (opts) {
			self._socket = false;
			console.warn('wsc', 'Reconnecting in', opts.scheduled, 'ms');
			console.warn('wsc', 'This is attempt', opts.attempt, 'out of', opts.retries);
			if (opts.attempt == opts.retries) {
				console.error("Unable to connect to backend, killing.")
				process.exit(1);
			}
		})
		.on('reconnected', function (opts) {
			self._socket = true;
			console.success('wsc', 'Socket reconnected successfully after', opts.duration, 'ms');

			self.getLatestBlock();
			self.getPending();
			self.getStats(true);
		})
		.on('reconnect timeout', function (err, opts) {
			self._socket = false;
			console.error('wsc', 'Socket reconnect atempt took too long:', err.message);
		})
		.on('reconnect failed', function (err, opts) {
			self._socket = false;
			console.error('wsc', 'Socket reconnect failed:', err.message);
		});
}

Node.prototype.emit = function (message, payload) {
	if (this._socket) {
		try {
			socket.emit(message, payload);
			console.sstats('wsc', 'Socket emited message:', chalk.reset.cyan(message));
			// console.success('wsc', payload);
		} catch (err) {
			console.error('wsc', 'Socket emit error:', err);
		}
	}
}

Node.prototype.getInfo = function () {
	console.info('==>', 'Getting info');
	console.time('Got info');

	try {
		this.info.coinbase = "";
		this.info.node = "Waiting node info..";
		this.info.net = "mainnet";
		this.info.protocol = "0.0.1";
		this.info.api = "1.0.0";

		console.timeEnd('Got info');

		let vm = this;
		axios.get('http://' + (process.env.RPC_HOST || 'localhost') + ':8669/staking/candidates')
			.then(function (response) {
				let current_node = response.data.find(n => n.ipAddr == (process.env.RPC_HOST || 'localhost'));
				// Fallback for nodes not part of the candidates list
				vm.info.name = (current_node !== undefined && 'name' in current_node) ? current_node.name : process.env.INSTANCE_NAME;
				vm.info.contact = (current_node !== undefined && 'description' in current_node) ? current_node.description : '(not a candidate node!)';
				vm.info.node = (current_node !== undefined && current_node.totalVotes > 0) ? ("Validator") : ("Full node");
				console.info(vm.info);
				return true;
			})
			.catch(function (error) {
				// handle error
				vm.stats.hashrate = 0;
				console.error("Node info not reachable")
				console.error(error);
				return false;
			})
		return true;
	} catch (err) {
		console.error("Couldn't get version");
		console.error(err)
	}
}

Node.prototype.setInactive = function () {
	this.stats.active = false;
	this.stats.peers = 0;
	this.stats.mining = false;
	this.stats.hashrate = 0;
	this._down++;

	this.setUptime();

	this.sendStatsUpdate(true);

	// Schedule web3 reconnect
	this.reconnectWeb3();

	return this;
}

Node.prototype.setUptime = function () {
	this.stats.uptime = ((this._tries - this._down) / this._tries) * 100;
}

Node.prototype.formatBlock = function (block) {
	if (!_.isNull(block) && !_.isUndefined(block) && !_.isUndefined(block.number) && block.number >= 0 && !_.isUndefined(block.difficulty) && !_.isUndefined(block.totalDifficulty)) {
		block.difficulty = block.difficulty.toString(10);
		block.gasLimit = 8000000;
		block.totalDifficulty = block.totalDifficulty.toString(10);

		if (!_.isUndefined(block.logsBloom)) {
			delete block.logsBloom;
		}

		return block;
	}

	return false;
}

Node.prototype.getTotalVotes = function () {
	let vm = this;
	axios.get('http://' + (process.env.RPC_HOST || 'localhost') + ':8669/staking/candidates')
		.then(function (response) {
			let current_node = response.data.find(n => n.ipAddr == (process.env.RPC_HOST || 'localhost'));
			if (current_node !== undefined && 'totalVotes' in current_node)
				vm.stats.hashrate = (parseInt(current_node.totalVotes) / 1000000);
			vm.stats.hashrate = 0;
		})
		.catch(function (error) {
			// handle error
			vm.stats.hashrate = 0;
			console.error("Node stats not reachable")
			console.error(error);
		})
}

Node.prototype.getLatestBlock = function () {
	const self = this;

	if (this._web3) {
		let timeString = 'Got block in' + chalk.reset.red('');
		console.time('==>', timeString);

		web3.eth.getBlock('latest', false, function (error, result) {
			self.validateLatestBlock(error, result, timeString);
		});
	}
}

Node.prototype.validateLatestBlock = function (error, result, timeString) {
	console.timeEnd('==>', timeString);

	if (error) {
		console.error("xx>", "getLatestBlock couldn't fetch block...");
		console.error("xx>", error);

		return false;
	}

	var block = this.formatBlock(result);

	if (block === false) {
		console.error("xx>", "Got bad block:", chalk.reset.cyan(result));

		return false;
	}

	if (this.stats.block.number === block.number) {
		console.warn("==>", "Got same block:", chalk.reset.cyan(block.number));

		if (_.isEqual(JSON.stringify(this.stats.block), JSON.stringify(block)))
			return false;

		console.stats(this.stats.block);
		console.stats(block);
		console.warn("Blocks are different... updating block");
	}

	console.warn("==>", "Got different block:", chalk.reset.cyan(block.number));
	console.sstats("==>", "Got block:", chalk.reset.red(block.number));

	this.stats.block = block;
	this.sendBlockUpdate();

	if (this.stats.block.number - this._lastBlock > 1) {
		var range = _.range(Math.max(this.stats.block.number - MAX_BLOCKS_HISTORY, this._lastBlock + 1), Math.max(this.stats.block.number, 0), 1);

		if (this._latestQueue.idle())
			this.getHistory({list: range});
	}

	if (this.stats.block.number > this._lastBlock) {
		this._lastBlock = this.stats.block.number;
	}
}

Node.prototype.getStats = function (forced) {
	let self = this;
	const now = _.now();
	let lastFetchAgo = now - this._lastFetch;
	this._lastFetch = now;

	if (this._socket)
		this._lastStats = JSON.stringify(this.stats);

	if (this._web3 && (lastFetchAgo >= UPDATE_INTERVAL || forced === true)) {
		console.stats('==>', 'Getting stats')
		console.stats('   ', 'last update:', chalk.reset.cyan(lastFetchAgo));
		console.stats('   ', 'forced:', chalk.reset.cyan(forced === true));

		self._tries++;

		let active = true;
		let peers = 0;
		let mining = true;
		self.getTotalVotes();
		let gasPrice = "500";
		let syncing = false;

		let end = _.now();
		let diff = end - self._lastFetch;

		console.sstats('==>', 'Got getStats results in', chalk.reset.cyan(diff, 'ms'));

		if (peers !== null) {
			self.stats.active = active;
			self.stats.peers = peers;
			self.stats.mining = mining;
			self.stats.gasPrice = gasPrice;

			if (syncing !== false) {
				let sync = results.syncing;

				let progress = sync.currentBlock - sync.startingBlock;
				let total = sync.highestBlock - sync.startingBlock;

				sync.progress = progress / total;

				self.stats.syncing = sync;
			} else {
				self.stats.syncing = false;
			}
		} else {
			self.setInactive();
		}

		self.setUptime();

		self.sendStatsUpdate(forced);

		/*
        async.parallel({
            peers: function (callback) {
                web3.net.getPeerCount(callback);
            },
            mining: function (callback) {
                web3.eth.getMining(callback);
            },
            hashrate: function (callback) {
                if (web3.eth.mining) {
                    web3.eth.getHashrate(callback);
                } else {
                    callback(null, 0);
                }
            },
            gasPrice: function (callback) {
                web3.eth.getGasPrice(callback);
            },
            syncing: function (callback) {
                web3.eth.getSyncing(callback);
            }
        },
            function (err, results) {
                self._tries++;

                if (err) {
                    console.error('xx>', 'getStats error: ', err);

                    self.setInactive();

                    return false;
                }

                results.end = _.now();
                results.diff = results.end - self._lastFetch;

                console.sstats('==>', 'Got getStats results in', chalk.reset.cyan(results.diff, 'ms'));

                if (results.peers !== null) {
                    self.stats.active = true;
                    self.stats.peers = results.peers;
                    self.stats.mining = results.mining;
                    self.stats.hashrate = results.hashrate;
                    self.stats.gasPrice = results.gasPrice.toString(10);

                    if (results.syncing !== false) {
                        var sync = results.syncing;

                        var progress = sync.currentBlock - sync.startingBlock;
                        var total = sync.highestBlock - sync.startingBlock;

                        sync.progress = progress / total;

                        self.stats.syncing = sync;
                    } else {
                        self.stats.syncing = false;
                    }
                }
                else {
                    self.setInactive();
                }

                self.setUptime();

                self.sendStatsUpdate(forced);
            });
            */
	}
}

Node.prototype.getPending = function () {
	let self = this;
	const now = _.now();

	if (this._web3) {
		console.stats('==>', 'Getting Pending')

		// NEW
		let pending = 10;
		var results = {};
		results.end = _.now();
		results.diff = results.end - now;

		console.sstats('==>', 'Got', chalk.reset.red(pending), chalk.reset.bold.green('pending tx' + (pending === 1 ? '' : 's') + ' in'), chalk.reset.cyan(results.diff, 'ms'));

		self.stats.pending = pending;

		if (self._lastPending !== pending)
			self.sendPendingUpdate();

		self._lastPending = pending;
	}
}

Node.prototype.getHistory = function (range) {
	let self = this;

	let history = [];
	let interval = {};

	console.time('=H=', 'his', 'Got history in');

	if (_.isUndefined(range) || range === null)
		interval = _.range(this.stats.block.number - 1, this.stats.block.number - MAX_HISTORY_UPDATE);

	if (!_.isUndefined(range.list))
		interval = range.list;

	console.stats('his', 'Getting history from', chalk.reset.cyan(interval[0]), 'to', chalk.reset.cyan(interval[interval.length - 1]));

	async.mapSeries(interval, function (number, callback) {
			web3.eth.getBlock(number, false, callback);
		},
		function (err, results) {
			if (err) {
				console.error('his', 'history fetch failed:', err);

				results = false;
			} else {
				for (var i = 0; i < results.length; i++) {
					results[i] = self.formatBlock(results[i]);
				}
			}

			if (Object.prototype.toString.call(results) === '[object Array]') {
				self.emit('history', {
					id: self.id,
					history: results.reverse()
				});
			}

			console.timeEnd('=H=', 'his', 'Got history in');
		});
}

Node.prototype.changed = function () {
	return !_.isEqual(this._lastStats, JSON.stringify(this.stats));
}

Node.prototype.prepareBlock = function () {
	return {
		id: this.id,
		block: this.stats.block
	};
}

Node.prototype.preparePending = function () {
	return {
		id: this.id,
		stats: {
			pending: this.stats.pending
		}
	};
}

Node.prototype.prepareStats = function () {
	return {
		id: this.id,
		stats: {
			active: this.stats.active,
			syncing: this.stats.syncing,
			mining: this.stats.mining,
			hashrate: this.stats.hashrate,
			peers: this.stats.peers,
			gasPrice: this.stats.gasPrice,
			uptime: this.stats.uptime
		}
	};
}

Node.prototype.sendBlockUpdate = function () {
	this._lastBlockSentAt = _.now();
	console.warn("Block update request sent")
	console.stats("wsc", "Sending", chalk.reset.red("block"), chalk.bold.white("update"));
	this.emit('block', this.prepareBlock());
}

Node.prototype.sendPendingUpdate = function () {
	console.stats("wsc", "Sending pending update");
	this.emit('pending', this.preparePending());
}

Node.prototype.sendStatsUpdate = function (force) {
	if (this.changed() || force) {
		console.stats("wsc", "Sending", chalk.reset.blue((force ? "forced" : "changed")), chalk.bold.white("update"));
		let stats = this.prepareStats();
		console.info(stats);
		this.emit('stats', stats);
		// this.emit('stats', this.prepareStats());
	}
}

Node.prototype.ping = function () {
	this._latency = _.now();
	socket.emit('node-ping', {
		id: this.id,
		clientTime: _.now()
	});
};

Node.prototype.setWatches = function () {
	let self = this;

	this.setFilters();

	this.updateInterval = setInterval(function () {
		self.getStats();
	}, UPDATE_INTERVAL);

	if (!this.pingInterval) {
		this.pingInterval = setInterval(function () {
			self.ping();
		}, PING_INTERVAL);
	}
	self.stats.syncing = false;
	self.setFilters();
}

Node.prototype.setFilters = function () {
	let self = this;

	this._latestQueue = async.queue(function (hash, callback) {
		let timeString = 'Got block ' + chalk.reset.red(hash) + chalk.reset.bold.white(' in') + chalk.reset.green('');

		console.time('==>', timeString);

		web3.eth.getBlock(hash, false, function (error, result) {
			self.validateLatestBlock(error, result, timeString);
			callback();
		});
	}, 1);

	this._latestQueue.drain = function () {
		console.sstats("Finished processing", 'latest', 'queue');

		self.getPending();
	}

	this._debouncedChain = debounce(function (hash) {
		console.stats('>>>', 'Debounced');
		self._latestQueue.push(hash);
	}, 120);

	this._debouncedPending = debounce(function () {
		self.getPending();
	}, 5);

	try {
		this.chainFilter = web3.eth.filter('latest');
		this.chainFilter.watch(function (err, hash) {
			const now = _.now();
			let time = now - self._lastChainLog;
			self._lastChainLog = now;

			if (hash === null) {
				hash = web3.eth.blockNumber;
			}

			console.stats('>>>', 'Chain Filter triggered: ', chalk.reset.red(hash), '- last trigger:', chalk.reset.cyan(time));

			if (time < self._chan_min_time) {
				self._chainDebouncer++;
				self._chain_debouncer_cnt++;

				if (self._chain_debouncer_cnt > 100) {
					self._chan_min_time = Math.max(self._chan_min_time + 1, 200);
					self._max_chain_debouncer = Math.max(self._max_chain_debouncer - 1, 5);
				}
			} else {
				if (time > 5000) {
					self._chan_min_time = 50;
					self._max_chain_debouncer = 20;
					self._chain_debouncer_cnt = 0;
				}
				// reset local chain debouncer
				self._chainDebouncer = 0;
			}

			if (self._chainDebouncer < self._max_chain_debouncer || now - self._lastBlockSentAt > 5000) {
				if (now - self._lastBlockSentAt > 5000) {
					self._lastBlockSentAt = now;
				}

				self._latestQueue.push(hash);
			} else {
				self._debouncedChain(hash);
			}
		});

		console.success("Installed chain filter");
	} catch (err) {
		this.chainFilter = false;

		console.error("Couldn't set up chain filter");
		console.error(err);
	}

	try {
		this.pendingFilter = web3.eth.filter('pending');
		this.pendingFilter.watch(function (err, hash) {
			const now = _.now();
			let time = now - self._lastPendingLog;
			self._lastPendingLog = now;

			console.stats('>>>', 'Pending Filter triggered:', chalk.reset.red(hash), '- last trigger:', chalk.reset.cyan(time));

			if (time > 50) {
				self.getPending();
			} else {
				self._debouncedPending();
			}
		});

		console.success("Installed pending filter");
	} catch (err) {
		this.pendingFilter = false;

		console.error("Couldn't set up pending filter");
		console.error(err);
	}
}

Node.prototype.init = function () {
	// Fetch node info
	this.getInfo();

	// Start socket connection
	this.startSocketConnection();

	// Set filters
	this.setWatches();
}

Node.prototype.stop = function () {
	if (this._socket)
		socket.end();

	if (this.updateInterval)
		clearInterval(this.updateInterval);

	if (this.pingInterval)
		clearInterval(this.pingInterval);

	web3.reset(false);
}

module.exports = Node;
