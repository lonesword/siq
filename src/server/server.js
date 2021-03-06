let http = require('http');
let nconf = require('nconf');
let WebSocketServer = require('ws').Server;
let Util = require('../utils');
let MessageBroker = require('./messageBroker');
let DB = require('./db');

var logger = Util.logger;
var serialize = Util.serialize;

nconf.argv().env().file('serverConfig.development.json');
nconf.defaults({
	'http': {
		'port': 4000
	},
	'ws': {
		'port': 4444
	}
});

/*
	Set up the HTTP server
*/

var httpServer = http.createServer((request, response) => {
	response.setHeader('Content-Type', 'application/json');
	response.writeHead(200);
	response.write(serialize(MessageBroker.getState()));
	response.end();
});

httpServer.listen(nconf.get("http:port"), () => {
	logger.info('HTTP server running at ' + nconf.get('http:port'));
});

/*
	Initialize the web socket server
*/
var wsServer = new WebSocketServer({
	port: nconf.get("ws:port")
});

function addMessage(ws, data){
	try{
				
		var id = MessageBroker.add(data.queue, data.message);
		
		/*Let the producer know that the message was enqueued, by sending the producer the message id*/
		var payload = {
			topic: "ID",
			id: id,
			ackId: data.ackId,
			producerId: data.producerId
		};
		ws.send(serialize(payload));
	}
	catch(e){
		var payload = {
			topic: "ERROR",
			ackId: data.ackId,
			error: e,
			producerId: data.producerId
		};
		logger.error(e);
		ws.send(serialize(payload));
	}
};

function subscribe(ws, data){
	try{
		var id = MessageBroker.subscribe(ws, data.queue, data.consumerId);
		/*Let the consumer know that subscription was successful*/
		var payload = {
			topic: "SUBSCRIPTION_ACK",
			consumerId: id
		};
		ws.send(serialize(payload));
	}
	catch(e){
		var payload = {
			topic: "SUBSCRIPTION_ERROR",
			ackId: data.ackId,
			error: e
		};
		logger.error(e);
		ws.send(serialize(payload));
	}
};

function acknowledgeMessage(ws, data){
	MessageBroker.acknowledgeMessage(data.queue, data.consumerId);
};

function createQueue(ws, data){
	try{
		var queue = MessageBroker.createQueue(data.queue, data.bufferSize);
		var payload = {
			topic: "CREATE_QUEUE_ACK",
			queue: queue.name
		};
		ws.send(serialize(payload));
	}
	catch(e){
		logger.error(e);
	}

}
/*
	Load persisted messages into the MessageBroker from the DB
*/

/*
	TODO:

	Dispatch 'disconnect' event on crash/close. Handle SIGTERM and SIGKILL events gracefully.
	In case of an ungraceful shutdown, the regular ping checks should allow the consumers
	to know if the server is alive
*/
MessageBroker.load(() => {
	wsServer.on('connection', (ws) => {
		logger.debug('websocket connection accepted');
		ws.on('message', (data) => {
			data = JSON.parse(data);
			/*TODO: Enumerate all the topics somewhere in a file*/
			switch(data.topic){
				/*Producer wants to add a message to a queue*/
				case 'ADD':
					addMessage(ws, data);			
					break;
				/*Consumer wants to subscribe to a queue*/
				case 'SUBSCRIBE':
					subscribe(ws, data);
					break;
				/*Consumer acknowledging a queue flush*/
				case 'MSG_ACK':
					acknowledgeMessage(ws, data);
					break;
				case 'CREATE_QUEUE':
					createQueue(ws, data);
					break;
			}
		})
	});	
})

logger.info('Websocket server running at ' + nconf.get('ws:port'));

module.exports = httpServer;