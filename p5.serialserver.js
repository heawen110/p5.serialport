/*
	p5.serialserver.js
*/
var SerialPort = require("serialport");
var _ = require('lodash');

var LOGGING = false;

var wss = null;
var serialPort = null;
var clients = [];

var serialPortList = [];

var logit = function(mess, index) {
	if (LOGGING) {
		if(index == null){
			console.log(mess);
		} else {
			console.log(`port[${index}]:` + mess);
		}
	}
};

var start = function () { 
	logit("start()");

	var SERVER_PORT = 8081;

	var WebSocketServer = require('ws').Server;
	wss = new WebSocketServer({perMessageDeflate: false, port: SERVER_PORT});

	const openSerial = function(serialPortAddress, serialPortOptions) {

		var previousPortIndex = _.findIndex(serialPortList, (p) => p.serialport === serialPortAddress)
		var previousPort = serialPortList[previousPortIndex]
		var index = previousPortIndex === -1 ? serialPortList.length : previousPortIndex;
		logit("openSerial: " + serialPortAddress);

			if (previousPortIndex === -1 || previousPort.isOpen() == false) {
				if (!serialPortOptions.hasOwnProperty('autoOpen')) {
					serialPortOptions.autoOpen = false;
				}

				serialPort = new SerialPort(serialPortAddress, serialPortOptions,
					function(err) {
						if (err) {
							console.log(err);
							sendit({method:'error', data: err});
						}
					}
				);

				serialPort.on('data', function(incoming) {
					//{"type":"Buffer","data":[10]}
					for (var i = 0; i < incoming.length; i++) {
						sendit({method:'data',data:incoming[i], portIndex: index });
					}
				});

				serialPort.on('close', function(data) {
					logit("serialPort.on close", index);
					sendit({method: 'close', data:data, portIndex: index });
				});

				serialPort.on('error', function(data) {
					logit("serialPort.on error " + data, index);
					sendit({method: 'error', data:data, portIndex: index });
				});

				serialPort.open(function (err) {
					logit("serialPort.open", index);

					if ( err ) {
						sendit({method:'error', data:"Couldn't open port: " + serialport, portIndex: index});
					} else {
						sendit({method:'openserial',data:{}, portIndex: index});
					}
				});
				serialPortList.splice(index, 1, serialPort);
			} else {
				sendit({method:'error', data:"Already open", portIndex: index});
				logit("serialPort is already open");
				sendit({method:'openserial',data:{}, portIndex: index});
			}
	}

	var closeSerial = function(index) {
		const serialPort = serialPortList[index]
		if (serialPort != null && serialPort.isOpen()) {
			logit("serialPort != null && serialPort.isOpen so close", index);
			logit("serialPort.flush, drain, close", index);

			serialPort.flush();
			serialPort.drain();
			serialPort.close(
				function(error) {
					if (error) {
						sendit({method:'error', data:error, portIndex: index});
						console.log(error);
					}
				}
			);
			serialPortList = _.pullAt(serialPortList, index)
		} else {
			logit("port do not existed or is closed")
		}
	};


	var sendit = function(toSend) {
		var dataToSend = JSON.stringify(toSend);
		for (var c = 0; c < clients.length; c++) {
			try {
				clients[c].send(dataToSend);
			} catch (error) {
				console.log("Error sending: ", error);
			}
		}
	};

	wss.on("connection", (ws) => {
		// Push the connection into the array of clients
		clients.push(ws);
		// Create an object to hold information about the connection
		ws.clientData = {
			origin: ws.upgradeReq.headers['origin'],
			id: ws.upgradeReq.headers['sec-websocket-key']
		}
		sendit({method: 'registerClient', data: ws.clientData})
	
		SerialPort.list(function (err, ports) {
			var portNames = [];
			ports.forEach(function(port) {
				portNames.push(port.comName);
			});
			sendit({method: 'list', data: portNames});
		});

		ws.on('message', function(inmessage) {
			var message = JSON.parse(inmessage);

			if (typeof message !== "undefined" && typeof message.method !== "undefined" && typeof message.data !== "undefined") {
					if (message.method === "echo") {
						sendit({method:'echo', data:message.data});
					} else if (message.method === "registerClient") {
						for (var c = 0; c < clients.length; c++) {
							sendit({method: 'registerClient', data: clients[c].clientData, portAddress: message.portAddress})
						}
					} else if (message.method === "list") {
						SerialPort.list(function (err, ports) {
							var portNames = [];
							ports.forEach(function(port) {
								portNames.push(port.comName);
							});

							sendit({method:'list', data:portNames});
						});
					} else if (message.method === "openserial") {	

						logit("message.method === openserial");
							
						// Open up
						if (typeof message.data.serialport === 'string') {
							logit("new SerialPort.SerialPort");

							openSerial(message.data.serialport, message.data.serialoptions);

						} else {
							logit("User didn't specify a port to open");
							sendit({method: 'error', data:"You must specify a serial port to open"});
						}

					} else if (message.method === "write") {
						
						serialPort.write(message.data);

					} else if (message.method === "close") {
						logit("message.method === close", message.portAddress);
						const index = _.findIndex(serialPortList, (p)=> p.serialport === message.portAddress)
						if(index !== -1)
							closeSerial(index);
					}
			}
			else {
				console.log("Not a message I understand: " + JSON.stringify(message));
			}
		});

		ws.on('close', function() {
			logit("ws.on close - client left");

			for (var c = 0; c < clients.length; c++) {
				if (clients[c] === ws) {
					logit("removing client from array");

					clients.splice(c,1);

					logit(clients.length + " clients left");
					break;
				}
			}

			if (clients.length == 0) {
				logit("clients.length == 0 checking to see if we should close all serial ports")
				// Should close serial port
				_.forEach(serialPortList, (p, i)=> closeSerial(i))
			}
		});
	});
};

var stop = function() {
	logit("stop()");

	_.forEach(serialPortList, (serialPort, index)=>{
		if (serialPort != null && serialPort.isOpen()) {
			logit("serialPort != null && serialPort.isOpen() is true", index);
			logit("serialPort.flush, drain, close", index);

			serialPort.flush();
			serialPort.drain();
			serialPort.close(
				function(error) {
					if (error) {
						console.log("Close Error: " + error);
					}
				}
			);
		}

		try {
			for (var c = 0; c < clients.length; c++) {
				if (clients[c] != null) {
					logit("clients[" + c + "] != null, close");

					clients[c].close();
				}
			}
		} catch (e) {
			console.log("Error Closing: " + e);
		}

		if (wss != null) {
			logit("wss != null so wss.close()");
			wss.close();
		}

		// Let's try to close a different way
		if (serialPort != null && serialPort.isOpen()) {
			logit("serialPort != null && serialPort.isOpen() is true so serialPort = null");
			serialPort = null;
		}
	})

}

module.exports.start = start;
module.exports.stop = stop;

//start();
