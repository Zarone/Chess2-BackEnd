const express = require('express');
const http = require('http');
const socket = require('socket.io');

const port = process.env.PORT || 8080

var app = express();
const server = http.createServer(app)
const io = socket(server)

let rooms = []
let roomCount = 0;

io.on('connection', function (socket) {
    let playerId =  Math.floor((Math.random() * 100) + 1)
    
    console.log(playerId + ' connected');

    socket.on('joined', function (roomId) {
        console.log("joined", roomId)
        // // games[roomId] = {}
        // if (games[roomId].players < 2) {
        //     games[roomId].players++;
        //     games[roomId].pid[games[roomId].players - 1] = playerId;
        // }
        // else{
        //     socket.emit('full', roomId)
        //     return;
        // }
        
        // console.log(games[roomId]);
        // players = games[roomId].players
        

        // if (players % 2 == 0) color = 'black';
        // else color = 'white';

        // socket.emit('player', { playerId, players, color, roomId })
        // players--;

        
    });

    socket.on('move', function (msg) {
        console.log("move", msg);
        // socket.broadcast.emit('move', msg);
    });

    socket.on('play', function (msg) {
        // socket.broadcast.emit('play', msg);
        console.log("ready " + msg);
    });

    socket.on('disconnect', function () {
        console.log(playerId + ' disconnected');
    }); 

    
});

server.listen(port);
console.log('Connected');