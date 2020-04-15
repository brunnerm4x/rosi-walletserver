
// ---- TASK MANAGEMENT

let openTasks = [];		// Buffer for tasks while wallet is undefined

// Add new task to schedule
var taskPush = function(wallet, taskname, params, priority, persistend = true, resolve = false, reject = false)
{
	console.log('Pushing new Task: ' + taskname);
	
	let timestamp = Date.now();
	let task = {
		taskname: taskname,
		params: params,
		priority: priority,
		timestamp: timestamp,
		persistend: persistend,
		resolve: resolve,
		reject: reject
	};
	
	let i;
	
	if(typeof wallet == 'object')
	{
		// get index of new task in array, insert task to be executed after the last task with same or higher priority
		// eg prioritys in task array: 1, 1 , 6; new task priority: 5 -> new array: 1, 1, 5, 6 
		for(i = 0; i < wallet.tasks.length && wallet.tasks[i].priority < priority; i++);
		
		// insert new task
		wallet.tasks.splice(i, 0, task);
	}
	else
	{
		console.warn('Wallet not ready, buffering task - persistence CANNOT BE GUARANTEED!');
		openTasks.push(task);
	}
}


// takes buffered tasks and appends them to wallet tasks
var pushBufferedTasks = function(wallet)
{
	console.log('Pushing buffered tasks to wallet tasks.');
	
	openTasks.forEach((task) => {
		taskPush(wallet, task.taskname, task.params, task.priority, task.persistend, task.resolve, task.reject);
	});
	
	openTasks = [];
}

// Get next task to be executed
var taskPop = function(wallet, ignoreTasknames = [])
{
	// Check if unused inputs are available
	
	let availableBalance = wallet.balance - wallet.pending_bal.reduce((acc, val) => acc + val, 0);
	
	var task =  wallet.tasks.filter((t) => { 
			return ignoreTasknames.indexOf(t.taskname) == -1; 
		}).filter((t) => {
			return !(t.taskname == 'sendFunds' && t.params.amount > availableBalance);
		}).pop();
		
	if(typeof task != 'object')
	{
		return false;		// no task to execute
	}
	
	let i = wallet.tasks.length -1;
	for(; i >= 0 && wallet.tasks[i].taskname != task.taskname; i--);
	wallet.tasks.splice(i, 1);
	
	return task;
}


// Returns amount of tasks with specified taskname
var hasTaskWithName = function(wallet, taskname)
{
	return wallet.tasks.filter(task => task.taskname == taskname).length;
}

// Returns an array of tasks with specified taskname, does not change taskarray
var getTasksWithName = function(wallet, taskname)
{
	return wallet.tasks.filter(task => task.taskname == taskname);
}

// Remove functions so that wallet can be serialized and stored in file
var makeTaskSerializeable = function(wallet)
{
	let walletNew = JSON.parse(JSON.stringify(wallet));
	
	walletNew.tasks = walletNew.tasks.map((task) => {
		if(!task.persistend)
		{
			return false;
		}
		task.resolve = false;
		task.reject = false;
		return task;
	}).filter(task => task !== false);
	
	return walletNew;
}



module.exports = {
	'taskPush'				: taskPush,
	'pushBufferedTasks'		: pushBufferedTasks,
	'taskPop'				: taskPop,
	'hasTaskWithName'		: hasTaskWithName,
	'getTasksWithName'		: getTasksWithName,
	'makeTaskSerializeable' : makeTaskSerializeable
}


