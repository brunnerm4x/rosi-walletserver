/*
 * ROSI
 * 
 * 
 * 	'lower level' functions for wallet functionalities
 *
 * 		DIFFERENCES WHEN USING NODE INSTEAD OF BROWSER:
 * 	
 * 			fs = require('fs'); instead of fs = require('./localstorage.js');
 * 
 * */

// provider start value
const iota_init_prov = ['https://node1.rosipay.net:443'
					];

const crypto = require('crypto');
const IOTA = require('iota.lib.js');

// Only nodejs version:
const fs = require('fs');	
// const fs = require('./localstorage.js');	// For browser version

const task = require('./wallet_task.js');	// to strip wallet tasks

var __dev_backup_prefix = 'wallet_backup';

if(typeof process.browser == 'undefined')
{
	__dev_backup_prefix = 'wallet_backup/';
}else{
	__dev_backup_prefix = 'wallet_backup';
}

// System constants
const ALLOWED_SEED_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ9";
const IOTA_SECURITY = 2;
const IOTA_DEPTH = 4;
const IOTA_PROMOTE_DEPTH = 4;
const IOTA_REATTACH_DEPTH = 4;
const IOTA_MINWEIGHTMAG = 14;
const IOTA_STDMSG = 'SENT9WITH9ROSI9PLUGIN';
const IOTA_STDTAG = '9SENT9WITH9ROSI9PLUGIN99999';

const REATTACH_MAX_CNT = 10;

// IOTA object
var iota = new IOTA();
var wallet_filename = "CLIENTWALLET";


var setWalletName = function(wallet_name)
{
	wallet_filename = wallet_name;
}

// Connects to Node and checks if ok
// callback(error)	(calls back even without error)
// error: 0 OK, 1 out of date, 2 api call returns error, 3 fatal js error
var setupCheckNode = function(provider, callback)
{
	try
	{
		iota = new IOTA({provider: provider});
		
		iota.api.getNodeInfo(function(error, success) 
		{
			if (error) 
			{
				console.log("iota api getNodeInfo error:", error);
				callback(2);
			} else 
			{
				if(success.latestMilestone == success.latestSolidSubtangleMilestone)
				{
					callback(0);	// OK
				}else{
					console.log("WARNING: node mybe out of date!");
					callback(1);
				}
			}
		});
	}catch(e)
	{
		console.log("An error occurred when requesting node info!");
		callback(3);
	}
}


// Store wallet to disk/database
// callback(err);
var storeWalletToFile = function(wallet, callback)
{
	var writeNewWalletToDisk = function()
	{
		let strippedWallet = task.makeTaskSerializeable(wallet);
		fs.writeFile(wallet_filename, JSON.stringify(strippedWallet), (err) => {
				callback(err);
		});
	}
	
	getWalletFromFile(function(oldwallet, err){
		if(!err && oldwallet.seed != wallet.seed)		// Backup wallet if this is no update
		{
			fs.writeFile(__dev_backup_prefix + wallet_filename + oldwallet.address.substring(0,10), 
							JSON.stringify(oldwallet), 
							(err) => 
			{
				console.log('Backed up old wallet.');
				writeNewWalletToDisk();
			});
		}else if(err == 'ENOENT' || oldwallet.seed == wallet.seed)	// OK, no wallet created yet / wallet update
		{
			writeNewWalletToDisk();
		}else{		// Something's fishy, abort
			callback(new Error('Unexpected error when checking for older wallet.' + err));
		}
	});
}


// restore Wallet from File
// callback(wallet, err)
var getWalletFromFile = function(callback)
{
	try
	{
		fs.readFile(wallet_filename, (err, data)=>{
			// 1. check if wallet object could be restored
			if(err){
				//
				//	When migrating to browser: check error codes from indexeddb!!!
				//
				if(err.code == 'ENOENT')
				{
					callback(false, 'ENOENT');
					return;
				}else{
					console.log("Unexpected getWalletFromFile Error:", err);
				}
		
				callback(false, err);
			}else
			{
				callback(JSON.parse(data), false);
			}	
		});
	}catch(e)
	{
		if(e.code == 'ENOENT')
		{
			callback(false, 'ENOENT');
		}else{
			console.log("Unexpected getWalletFromFile Error:", e);
		}
	}
}


// Setup new Wallet for user
// return wallet object
// Set seed param to false for automatic creation of new seed
var createWallet = function(seed)
{
	if(!seed)
	{
		seed = "";
		// Generate new seed for wallet
		crypto.randomBytes(81).forEach((value) => { 
			while(value > 243){ 		// against 'modulo biasing'
				value = crypto.randomBytes(1)[0]; 
			} 
			seed += ALLOWED_SEED_CHARS.charAt(value%27); 
		});
	}
	
	console.log("Created new seed.");
	
	wallet = {
		seed: seed,
		balance: 0,				// latest balance, this is an estaminated value, only reliable after updateBalance() call!
		index: -1,				// Address index for current address
		address: "",			// current (index) address
		inputs: [],				// Owned addresses with balance, which can be used for new outgoing transactions [{address, balance, security, keyIndex}]
		monitor_add: [],		// Input addresses which should be checked for a new transaction
		monitor_keyinx: [],		// Key indexes of monitored inputs
		pending_out: [],		// (probably) unconfirmed outputs, array of transactions hashes of the tail transaction
		pending_bal: [],		// balance of pending outputs (all tx inputs summed up)
		pending_infobal: [], 	// balance of pending outputs (real value, as requested when calling sendTransfer)
		pending_reattached: {},	// pending_reattached[tx_hash] = ["oldhash1", "oldhash2", ...]
		invalid_reattached: [],
		iota_provider: iota_init_prov,		// provider list to use
		iota_provider_inx: 0,	// index of current provider in provider list
		tasks: []				// array of sceduled tasks [{taskname, params:{}, priority, timestamp}, ...]  
								// (Splitted function in task name and params to make it serializeable)
	}
	
	return wallet;
}

// check if address is used, if so, increase index and create new
// callback(wallet, error)
var getAddress = function(wallet, callback)
{	
	var checkIfUsed = function()
	{
		// Check if address is already monitored ( == used)
		if(wallet.monitor_add.indexOf(wallet.address) >= 0)
		{
			nextAddress();
			return;
		}
		
		iota.api.findTransactionObjects({'addresses': [wallet.address]}, function(e,s)
		{
			if(e)
			{
				console.log("findTransactionObject error:", e);
				callback(false, e);	
			}else{
				if(s.length == 0)
				{
					// Address is unused and can be used
					callback(wallet, false);
				}else{
					nextAddress();
				}
			}
		});
	}
	
	var nextAddress = function()
	{
		wallet.index ++;
		iota.api.getNewAddress(wallet.seed, {index: wallet.index, checksum:true, total:1, security:IOTA_SECURITY}, function(e, s)
		{
			if(e)
			{
				console.log("getNewAddress error:", e);
				callback(false, e);	
			}else{
				wallet.address = s[0];
				checkIfUsed();
			}
		});
	}	
	
	
	// First setup if index is -1
	if(wallet.index < 0)
	{
		wallet.index = -1;
		nextAddress();
	}else 				// check if current address is already used
	{
		checkIfUsed();
	}
}


// get unused address, then attach it with a 0 value tx
// callback(error, wallet)
var getAttachedAddress = function(wallet, callback)
{
	getAddress(wallet, function(wallet, error)
	{
		if(!error)
		{
			sendTransfer(wallet, wallet.address, 0, function(error, wallet){
				if(!error)
				{
					callback(false, wallet);
				}else{
					console.log('An error occurred when attaching address to tangle.');
					callback(error, wallet);
				}
			});
		}else{
			console.log("Error occured when trying to get new Address!");
			callback(error, wallet);
		}
	});
} 


// Attach input address to tangle
var attachAddressToTangle = function(wallet, address, callback)
{
	sendTransfer(wallet, address, 0, function(error, wallet){
		
		if(!error)
		{
			callback(false, wallet);
		}else{
			console.log('An error occurred when attaching address to tangle.');
			callback(error, wallet);
		}
	});
}


// check for every address until current wallet index (+1)
// if a transaction is stored on the tangle
// -> if not, attach it with 0 value tx
// callback(error, wallet);
var checkAttachUntilIndex = function(wallet, callback)
{
	if(wallet.index < 0)
	{
		// nothing to do here
		console.log("Wallet is new, nothing to reattach.");
		callback(false, wallet);
		return;
	}
	
	const old_index = wallet.index;
	wallet.index = -1;
	
	(function checkForTx()
	{
		console.log("Checking inx", wallet.index, "of", old_index);
		if(wallet.index >= old_index)
		{
			// finished
			console.log("reattaching finished");
			callback(false, wallet);
			return;
		}
		
		getAttachedAddress(wallet, function(error, modw)
		{
			if(!error)
			{
				wallet = modw;
				checkForTx();
				return;
			}else{
				console.log("Error reattachUntilIndex getting Attached Address!");
				return;
			}
		});
	})();
}


// send amount iota to address (eg fund channel)
// callback(error, txHash), latest transaction is last object in pending_out
var sendTransfer = function(wallet, address, amount, callback)
{
	let options = {};
	let takenInputs = [];
	let availableAmount;
	
	var revertTakenInputs = function()
	{
		takenInputs.forEach((input) => {
			wallet.inputs.push(input);
		});
	};

	var preparedSend = function()
	{
		try
		{
			iota.api.sendTransfer(wallet.seed, IOTA_DEPTH, IOTA_MINWEIGHTMAG, 
				[{address: address, value: amount, message: IOTA_STDMSG, tag: IOTA_STDTAG}],
				options,
				function(err, bundles){
					if(err)
					{
						console.log("Error sending transfer:", err);
						revertTakenInputs();
						if(err.toString().indexOf('balance') > -1)
						{
							callback('INSUFFICIENT_FUNDS', wallet);
							return;
						}
						callback(err, false);
					}else{
						// Append transfer objects to wallet!
						if(amount > 0)
						{
							// get tail transaction hash and put in wallet outputs array
							wallet.pending_out.push(bundles[0].hash);
							wallet.pending_bal.push(availableAmount);
							wallet.pending_infobal.push(amount);
						}
						callback(false, bundles[0].hash);
					}
			});
		}catch(e)
		{
			console.log("sendTransfer and error has ocurred:", e);
			revertTakenInputs();
			callback(e, wallet);
		}
	};
	
	if(amount > 0)
	{
		options = {inputs: []};
		// Get remainder Address
		getAddress(wallet, (w, e) => {			
			// get inputs
			availableAmount = 0;
			while(availableAmount < amount)
			{
				let input = wallet.inputs.shift();
				if(typeof input != 'object')	// no more inputs available
				{
					// insufficient funds
					revertTakenInputs();
					callback('INSUFFICIENT_FUNDS');
					return;
				}
				availableAmount += input.balance;
				// options remainder address throws unhandled exception in crypto/converter 'Invalid trytes length' when given address with checksum
				input.address = iota.utils.noChecksum(input.address);		
				options.inputs.push(input);
				takenInputs.push(input);
			}
			
			// set remainder address, if needed
			if(availableAmount > amount)
			{
				options.address = iota.utils.noChecksum(wallet.address);
				wallet.monitor_add.push(wallet.address);
				wallet.monitor_keyinx.push(wallet.index);
			}
			// Continue
			preparedSend();			
		});
	}else
	{
		// Continue without options
		preparedSend();
	}
} 

// send amount iota to address (eg fund channel)
// callback(error, txHash), latest transaction is last object in pending_out
var sendToColdAddress = function(wallet, address, callback)
{
	let options = {};
	options = {inputs: []};
	let takenInput;
	
	if(wallet.inputs.length == 0)
	{
		callback("NO_INPUTS_AVAILABLE");
		return;
	}
	
	var revertTakenInput = () =>
	{
		wallet.inputs.push(takenInput);
	};

	takenInput = wallet.inputs.shift();
	options.inputs.push(takenInput);
	options.inputs[0].address = iota.utils.noChecksum(options.inputs[0].address);
	
	let amount = takenInput.balance;

	try
	{
		iota.api.sendTransfer(wallet.seed, IOTA_DEPTH, IOTA_MINWEIGHTMAG, 
			[{address: address, value: amount, message: IOTA_STDMSG, tag: IOTA_STDTAG}],
			options,
			function(err, bundles){
				if(err)
				{
					console.log("Error sending transfer to cold address:", err);
					revertTakenInput();
					if(err.toString().indexOf('balance') > -1)
					{
						callback('INSUFFICIENT_FUNDS', wallet);
						return;
					}
					callback(err, false);
				}
				else
				{
					// get tail transaction hash and put in wallet outputs array
					wallet.pending_out.push(bundles[0].hash);
					wallet.pending_bal.push(amount);
					wallet.pending_infobal.push(amount);
					callback(false, bundles[0].hash);
				}
		});
	}catch(e)
	{
		console.log("sendToColdAddress error has ocurred:", e);
		revertTakenInput();
		callback(e, wallet);
	}
} 


// takes transaction tail hashes stored in wallet
// checks if confirmed (then removes them)
// and reattaches unconfirmed transactions
// callback(error, wallet)
var reattachPending = function(wallet, callback)
{
	if(wallet.pending_out.length == 0)
	{
		callback(false, wallet);
		return;
	}
	
	try
	{
		// get inclusion states of the functions 
		iota.api.getLatestInclusion(wallet.pending_out, function(e, inclutionstate)
		{
			if(!e)
			{
				var pending_new = [];
				var pending_bal_new = [];
				var pending_infobal_new = [];
				var pending_bal_old = wallet.pending_bal.reduce((acc, curr) => {return acc + curr;}, 0);
				var finalize_pending = function()
				{
					wallet.pending_out = pending_new;
					wallet.pending_bal = pending_bal_new;
					wallet.pending_infobal = pending_infobal_new;
					let pending_sum = wallet.pending_bal.reduce((acc, curr) => {return acc + curr;}, 0);
					let pending_diff = (pending_bal_old - pending_sum);
					if(pending_diff > 0)
					{
						console.log('Outputs confirmed, removing', pending_diff + 'i from wallet balance.');
					}
					wallet.balance -= pending_diff;
					callback(false, wallet);
				};
				
				(function processNext()
				{
					if(wallet.pending_out.length == 0)
					{
						finalize_pending();
						return;
					}
					
					// Get next hash and corresponding confirmation state
					tx_hash = wallet.pending_out.shift();
					tx_bal = wallet.pending_bal.shift();
					tx_infobal = wallet.pending_infobal.shift();
					is_conf = inclutionstate.shift();
					
					if(is_conf == true)
					{
						if(typeof wallet.pending_reattached[tx_hash] != 'undefined')
						{
							delete wallet.pending_reattached[tx_hash];
						}
						processNext();
						return;
					}
					
					var continue_promotion = function()
					{	
						// Promote if promoteable, else reattach if reattachable
						try
						{
							iota.api.isPromotable(tx_hash).then((isPromotable) =>  
							{
								if(isPromotable == true)
								{
									try
									{ 
										// Promote
										console.log("Promoting bundle...");
										iota.api.promoteTransaction(tx_hash, IOTA_PROMOTE_DEPTH, IOTA_MINWEIGHTMAG, 
										[{address: '9'.repeat(81), value: 0, message: IOTA_STDMSG, tag: IOTA_STDTAG}], {}, function(e,s)
										{
											if(e)
											{
												console.log("Error occurred while promoting:", e);
											}else{
												console.log("Successfully promoted.");
											}
											pending_new.push(tx_hash);	// tx_hash did not change with promotion
											pending_bal_new.push(tx_bal);
											pending_infobal_new.push(tx_infobal);
											processNext();
										});
									}catch(e)
									{
										console.log("Error occurred while promoting:", e);
										pending_new.push(tx_hash);	// tx_hash did not change with promotion
										pending_bal_new.push(tx_bal);
										pending_infobal_new.push(tx_infobal);
										processNext();
									}
								}else
								{
									// check if reattachable
									try
									{
										iota.api.isReattachable(tx_hash, function(e, isReattachable)
										{
											if(!e)
											{
												if(isReattachable)
												{
													// Reattach
													try
													{
														console.log("Reattaching bundle...");
														iota.api.replayBundle(tx_hash, IOTA_REATTACH_DEPTH, IOTA_MINWEIGHTMAG, (e,s)=>{
															if(e)
															{
																console.log("Error occurred when reattaching:", e);
																pending_new.push(tx_hash);
															}else{
																console.log("Successfully reattached.");
																pending_new.push(s[0].hash);	// Replace old tx hash with new one
																if(typeof wallet.pending_reattached[tx_hash] != 'undefined')
																{
																	wallet.pending_reattached[s[0].hash] = wallet.pending_reattached[tx_hash];
																	wallet.pending_reattached[s[0].hash].push(tx_hash);
																	delete wallet.pending_reattached[tx_hash];
																	if(wallet.pending_reattached[s[0].hash].length > REATTACH_MAX_CNT)
																	{
																		// Max reattachments -> give up and do not try to reattach further
																		// add tx to list of unable to reattach transactions
																		if(typeof wallet.invalid_reattached == "undefined")
																			 wallet.invalid_reattached = [];
																			 
																		wallet.invalid_reattached.push(s[0].hash);
																		delete wallet.pending_reattached[s[0].hash];
																		pending_new.pop();
																		console.warn("Deleted " + s[0].hash + 
																			" from wallet reattach queue, because of the amount of reattachments.");
																	}
																}else{
																	wallet.pending_reattached[s[0].hash] = [tx_hash];
																}
															}
															pending_bal_new.push(tx_bal);
															pending_infobal_new.push(tx_infobal);
															processNext();
														});
													}catch(e)
													{
														console.log("Error occurred when reattaching:", e);
														pending_new.push(tx_hash);
														pending_bal_new.push(tx_bal);
														pending_infobal_new.push(tx_infobal);
													}
												}else
												{
													console.log("WARNING: Transaction is not reattachable!");
													pending_new.push(tx_hash);
													pending_bal_new.push(tx_bal);
													pending_infobal_new.push(tx_infobal);
													processNext();
												}
											}else{
												// ERROR
												console.log("Error occurred when checking reattachability.");
												pending_new.push(tx_hash);
												pending_bal_new.push(tx_bal);
												pending_infobal_new.push(tx_infobal);
												processNext();
											}
										});
									}catch(e){
										console.log("Error occurred when checking reattachability:", e);
										pending_new.push(tx_hash);
										pending_bal_new.push(tx_bal);
										pending_infobal_new.push(tx_infobal);
										processNext();
									}
								}
							}).catch((error)=>
							{
								// ERROR
								if(("" + error).search("not a tail") == -1)
								{
									console.log("Error occurred when checking promotiability. E2:", error);
									pending_new.push(tx_hash);
									pending_bal_new.push(tx_bal);
									pending_infobal_new.push(tx_infobal);
								}
								else
								{
									// TODO: experimental feature - this should not be necessary, find bugs so that correct transaction hashes are
									// appendet to list - propbaly close channel transactions are the problem ....
									console.log("ERROR: Not a Tail Transaction Hash! This hash and corresponding balances will be deleted from the Promote List!");
								}
								processNext();
							});	

						}catch(e) 
						{
							console.log("Error occurred when checking promotiability. E1:", e);
							pending_new.push(tx_hash);
							pending_bal_new.push(tx_bal);
							pending_infobal_new.push(tx_infobal);
							processNext();
						}
					};					
					if(typeof wallet.pending_reattached[tx_hash] != 'undefined')	
					{	
						console.log("Checking reattached transactions...");
						// Check if a reattachment has confirmed...		
						try
						{
							iota.api.getLatestInclusion(wallet.pending_reattached[tx_hash], function(e, attis)
							{
								if(e)
								{
									console.log("Error occurred when checking inclusionstate of previously attached transactions. E2:", e);
									continue_promotion();
								}else{
									for(let i = 0; i < attis.length; i++)
									{
										if(attis[i] == true)
										{
											// already confirmed
											console.log("Found reattached confirmed transaction.");	
											delete wallet.pending_reattached[tx_hash];
											processNext();
											return;
										}
									}
									continue_promotion();
								}
							});	
						}catch(e)
						{
							console.log("Error occurred when checking inclusionstate of previously attached transactions. E1:", e);
							continue_promotion();
						}
					}else{
						// No previously created reattachments
						continue_promotion();
					}						
				}());
			}else
			{
				console.log("Error occurred getting inclusion states.");
				callback(e, wallet);
			}
		});
	}catch(e)
	{
		console.log("An error occurred while reattaching:", e);
		callback(e, wallet);
	}
}


// put function on list to be monitored
var addMonitoredAddress = function(wallet, address, keyInx)
{
	if(wallet.monitor_add.indexOf(address) > -1)
	{
		console.log("Address already in list, skipping.");
		return;
	}
	
	wallet.monitor_add.push(address);
	wallet.monitor_keyinx.push(keyInx);
	console.log("Address added to monitor list.");
}


// remove address from monitored addresses array
var removeMonitoredAddress = function(wallet, address)
{
	let index = wallet.monitor_add.indexOf(address);
	if(index < 0)
	{
		console.log("Address cannot be found on monitor list.");
		return false;
	}else 
	{
		wallet.monitor_add.splice(index, 1);
		wallet.monitor_keyinx.splice(index, 1);
		console.log("Removed address from monitor list.");
		return address;
	}
}


// Loops through all addresses on monitor list,
// checks if there is an confirmed value input on any of that addresses
// if so, deletes this address from the list and calls
// callback(err, [{address: removedAddr, balance: confirmedInput},...]), 
// with error false (if no error)
// and array of addresses with confirmed inputs
var checkMonitorList = function(wallet, callback)
{
	try
	{
		iota.api.getBalances(wallet.monitor_add, 100, function(error, success)
		{
			if(!error)
			{
				var balances = success.balances;
				
				var removedList = [];
				var monitor_add_new = [];
				var monitor_keyinx_new = [];
				for(let i = 0; i < balances.length; i++)
				{
					if(balances[i] > 0)
					{
						removedList.push({	address:wallet.monitor_add[i], 
											balance:balances[i], 
											keyIndex: wallet.monitor_keyinx[i], 
											security: IOTA_SECURITY });
					}else
					{
						monitor_add_new.push(wallet.monitor_add[i]);
						monitor_keyinx_new.push(wallet.monitor_keyinx[i]);
					}
				}
				
				wallet.monitor_add = monitor_add_new;
				wallet.monitor_keyinx = monitor_keyinx_new;
				callback(false, removedList);
			}else
			{
				console.log("Error getting Balances No 1:", error);
				callback(error, false);
			}
		});
	}catch(e)
	{
		console.log("Error getting Balances No 2:", e);
		callback(e, false);
	}
}


// Checks a single address for balance
// callback(balance), callback(false) if error
var getBalanceOfAddress = function(address, callback)
{
	try
	{
		iota.api.getBalances([address], 100, function(error, success)
		{
			if(!error)
			{
				callback(success.balances[0]);
			}else
			{
				console.log("Error getting address balances 1:", error);
				callback(false);
			}
		});
	}catch(e)
	{
		console.log("Error getting address balance 2:", e);
		callback(false);
	}
}

// check if bundle is valid (sum = 0, etc)
// check if all inputs are from addresses with confirmed balance
// callback(ok), ok === true if balance found, 0 if no balance found, false if network error, etc
var checkBundleUnconfirmedInputs = function(bundleHashes, bundleTransactionObjects, callback)
{
	// Sort transactionObjects to bundle
	bundles = [];	// bundles[bundle]
	bundleTransactionObjects.forEach((transaction)=>{
		
		var bundleNo = bundleHashes.indexOf(transaction.bundle);

		if(typeof bundles[bundleNo] == 'undefined')
		{
			bundles[bundleNo] = [];
		}
		
		bundles[bundleNo][transaction.currentIndex] = transaction;
	});
	
	let ok = true;
	bundles.forEach((bundle)=>{
		try
		{
			if(!iota.utils.isBundle(bundle))
			{
				callback(0);		// Cannot be accepted
				ok = false;
				return;
			}
		}catch(e)
		{
			console.error("checkBundleUnconfirmedInputs Error:" + e);
			ok = false;
			callback(0);		// Cannot be accepted
		}
	});
	
	if(!ok)
		return;
	
	// Now check inputs of bundles
	var inputAddresses = [];
	var inputValues = [];	// Values to check corresponding to inputAddresses
	bundles.forEach((bundle)=>{
		bundle.forEach((transaction)=>{
			if(transaction.value < 0)		// input to bundle
			{
				inputAddresses.push(transaction.address);
				inputValues.push((-1)*transaction.value);
			}
		});
	});
	try
	{
		// get confirmed balances of input addresses
		iota.api.getBalances(inputAddresses, 100, function(error, success)
		{
			if(error)
			{
				console.log('Error getting input address balance.');
				callback(false);
				return;
			}
			
			if(inputValues.every((val, inx)=>{ return val == success.balances[inx] }))		// all balances ok
			{
				// all ok
				console.log('Balances OK.');
				callback(true);
			}else{
				console.log('Not all balances are confirmed or real!');
				callback(0);
				return;
			}
		});
	}catch(e)
	{
		console.log('Error getting input address balance.');
		callback(false);
		return;
	}
}

// Checks a single address for balance, accepts unconfirmed transactions
// checks also balance of input addresses of bundle, which have to have confirmed
// balances with value of corresponding input
// callback(balance), callback(false) if error
var getUnconfirmedBalance = function(address, callback)
{
	try
	{
		iota.api.findTransactionObjects({'addresses': [address]}, (e, s)=>{
			
			if(e)
			{
				console.log('Cannot get TransactionObjects to check for unconfirmed balance. :', e);
				callback(false);
				return;
			}else{
				var bundles = [];		// [bundleHash1, bundleHash2, ...]
				var balance = 0;
				s.forEach((transaction)=>{ 
					if(bundles.indexOf(transaction.bundle) < 0 && transaction.value != 0){ 
							bundles.push(transaction.bundle); 
							balance += transaction.value;
				}});
				
				// Now get transaction objects of bundles...
				try
				{
					iota.api.findTransactionObjects({'bundles': bundles}, (e, s)=>{ 
						if(e)
						{
							console.log('Cannot get bundle TransactionObjects to check for unconfirmed balance. :', e);
							callback(false);
							return;
						}
						checkBundleUnconfirmedInputs(bundles, s, (ok)=>{
							if(ok === false)	// error getting values (network errors ...)
							{					// can be retried...
								callback(false);
							}else if(ok === true){				
								callback(balance);
							}else{				// just no unconfirmed balance (ok === 0)
								callback(0);
							}
						});
					});
				}catch(e)
				{
					console.log('Cannot get bundle transactionObjects to check for unconfirmed balance. :', e);
					callback(false);
				}
			}
		});
	}catch(e)
	{
		console.log("Error getting unconfirmed address balance 2:", e);
		callback(false);
	}
}


// takes signed bundles (from flash channel)
// and appends it to the tangle
// callback(err, sentBundles)
var sendBundles = function(bundles, callback)
{
	try
	{
		// var bundle = bundles[0];
		let sentBundles = [];
		
		(function sendBundle()
		{
			if(bundles.length == 0)
			{
				if(sentBundles !== false)
				{
					callback(false, sentBundles);
				}
				return;
			}
			
			let bundle = bundles.shift();
			
			let bundleTrytes = [];
			bundle.forEach(function (tx) {
				bundleTrytes.push(iota.utils.transactionTrytes(tx))
			});
			
			bundleTrytes = bundleTrytes.reverse();
			
			iota.api.sendTrytes(bundleTrytes, IOTA_DEPTH, IOTA_MINWEIGHTMAG, (e, s)=>{
				
				if(e)
				{
					console.log("Error sending bundles to tangle:", e);
					callback(e, false);
					sentBundles = false;
					return;
				}else{
					console.log('Sent bundle successfully to tangle.');
					sentBundles.push(s);
					sendBundle();
				}
			});
		}());
	}catch(e)
	{
		console.log("Error sending tryte Bundle:", e);
		callback(e);
	}
}


// Add external bundle to reattach/promote until confirmed
// txHash = bundles[0].hash
var addReattachWatchBundle = function(wallet, tailTxHash)
{
	// get tail transaction hash and put in wallet outputs array
	wallet.pending_out.push(tailTxHash);
	wallet.pending_bal.push(0);
	wallet.pending_infobal.push(0);
}


// Takes bundleHash and requests the tail hash of each (reattached) bundle
// callback(error, hashesArray)
var getBundleTailHashes = function(wallet, bundleHash, callback)
{
	try
	{
		iota.api.findTransactionObjects({'bundles': [bundleHash]}, function(e, s){
			if(e){
				callback(e, false);
				return;
			}
			
			callback(false, s.filter(tx => tx.currentIndex == 0).map(tx => tx.hash));
		});
	}catch(e)
	{
		console.log('Error getting bundle transactions');
		callback(e, false);
	}
}


// Takes bundlehash and checks if any (re) attachments have been confirmed
var isBundleConfirmed = function(wallet, bundleHash, callback)
{
	getBundleTailHashes(wallet, bundleHash, (e, txHashes)=>{
		try
		{
			if(e){
				callback(e, undefined);
				return;
			}
			
			iota.api.getLatestInclusion(txHashes, (e, s)=>{
				if(e){
					callback(e, undefined);
					return;
				}
				
				callback(false, s.some(state => state));
				return;
			});
		}catch(e)
		{
			callback(e, undefined);
		}
	});
}


module.exports = {
	'setWalletName'			: setWalletName,
	'setupCheckNode'		: setupCheckNode,		// Has to be called to initialize iota object!
	'storeWalletToFile'		: storeWalletToFile,
	'getWalletFromFile'		: getWalletFromFile,
	'createWallet'			: createWallet,
	'getAddress'			: getAddress,
	'attachAddressToTangle' : attachAddressToTangle,
	'getAttachedAddress'	: getAttachedAddress,
	'checkAttachUntilIndex'	: checkAttachUntilIndex,
	'sendTransfer'			: sendTransfer,
	'sendToColdAddress'		: sendToColdAddress,
	'reattachPending'		: reattachPending,
	'addMonitoredAddress'	: addMonitoredAddress,
	'removeMonitoredAddress': removeMonitoredAddress,
	'checkMonitorList'		: checkMonitorList,
	'getBalanceOfAddress'	: getBalanceOfAddress,
	'sendBundles'			: sendBundles,
	'getUnconfirmedBalance'	: getUnconfirmedBalance,
	'addReattachWatchBundle': addReattachWatchBundle,
	'getBundleTailHashes'	: getBundleTailHashes,
	'isBundleConfirmed'		: isBundleConfirmed
}



