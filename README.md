# ROSI Wallet-Server

## ROSI Payment System - Provider IOTA Wallet Server

### General Information on ROSI:
* https://rosipay.net (General User Information, Links)
* https://github.com/brunnerm4x/rosi (Main Github Repository)

### Description
Every provider needs a wallet to receive payments, this server communicates with the Pay-Server (that handles the Flash-Channels).

It is strongly advised to CLOSE the port of the wallet-server to the outside with a firewall. Only the faucet port has to bee free from the internet to enable users access the service.

### Dependencies 
* NodeJs (https://nodejs.org) 


### Installation
1. `git clone https://github.com/brunnerm4x/rosi-walletserver.git`
2. `cd rosi-walletserver/`
3. `npm i`

### Configuration
Main config can be done using npm (examples, see package.json):
* `npm config set rosi-walletserver:port 11000` (to set the port the server should listen)

Note: it is possible to start the server with a temporary port with `npm run start --rosi-walletserver:port=XXXX`, this also works for other npm configs.


### Run the Server
1. `npm start`


