let address = "QFBKPXMMQTM9IATEMAGHQUZJHTCTNEGB9RIBJNZJHPOABIQYKMESEFQNSYRLOMPJLOKVLEUDUXNMLRW9DN9XKLFP9W";			// address to which balance should be transferred
let threshold = 0;			// balance threshold to initiate transaction (balance to keep on wallet) must be > 0!!
let maxWaitingOutputs = 3;	

module.exports = {
	'address': address,
	'threshold':threshold,
	'maxWaitingOutputs':maxWaitingOutputs
}
