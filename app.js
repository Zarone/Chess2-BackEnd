require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors')
const socket = require('socket.io')

const port = process.env.PORT || 8080;

var app = express();

app.use(cors())

const server = http.createServer(app);
const io = socket(server, {
    cors: {
        origin: process.env.CLIENT,
        methods: ["GET", "POST"],
        transports: ['websocket', 'polling'],
        credentials: true
    },
    allowEIO3: true
});

// contains objects like {p1: {pid, isWhite}, p2: {pid, isWhite}, friendRoom: boolean}
// index by room ID
let rooms = {};

// contains IDs for rooms with only one player
let waitingRooms = []

let roomCount = 0;

const MAX_ROOMS = 20;

io.on('connection', function (socket) {
    let playerID =  Math.floor((Math.random() * 100) + 1)
    let thisRoomID = undefined;
    
    console.log(playerID + ' connected');

    socket.on('joined', ({roomID, friendRoom}) => {
        console.log("player joined room", roomID);
        
        thisRoomID = roomID;

        if (Object.keys(rooms).length >= MAX_ROOMS && rooms[roomID] == undefined){
            socket.emit("maximumPlayers")
            return
        } else if (rooms[roomID] == undefined){
            rooms[roomID] = {friendRoom}
            roomCount++;
        }

        // if this is the first player to join the room
        if (rooms[roomID].p1 == undefined){
            rooms[roomID].p1 = { pid: playerID, isWhite: true };

            socket.emit('player', rooms[roomID].p1 )
        } else if (rooms[roomID].p2 == undefined){
            
            if (playerID == rooms[roomID].p1.pid){
                playerID++;
            }

            rooms[roomID].p2 = { pid: playerID, isWhite: false };

            socket.emit('player', rooms[roomID].p2 )

            socket.emit("twoPlayers")
            socket.broadcast.emit("twoPlayers")
        } else {
            console.log("attempting to join full room")
            return
        }

        console.log(rooms)
        
    });
    
    socket.on('disconnect', () => {

        console.log(playerID + ' disconnected');
        
        let thisRoom = rooms[thisRoomID];
        if (thisRoom && thisRoom.p1 && thisRoom.p2) {
            if (thisRoom.p1.pid == playerID){
                socket.broadcast.emit('gameOver', {room: thisRoomID, id: thisRoom.p2.pid});
            } else {
                socket.broadcast.emit('gameOver', {room: thisRoomID, id: thisRoom.p1.pid});
            }
    
            delete rooms[thisRoomID]
        } else if (thisRoom){
            delete rooms[thisRoomID]
        }
        console.log("rooms", rooms)

    }); 

    socket.on("makeMove", (args)=>{
        // console.log("make move, args", args)
        socket.broadcast.emit("registeredMove", args)
    })

});

app.get("/getOpenRoom", (req, res)=>{
    console.log("/getOpenRoom")
    console.log("waitingRooms", waitingRooms)
    
    let openRoomID = undefined;

    for (let i = 0; i < waitingRooms.length; i++){
        console.log("rooms[waitingRooms[i]]", rooms[waitingRooms[i]])
        
        if ( !rooms[waitingRooms[i]] || rooms[waitingRooms[i]].p2 ){
            waitingRooms.splice(i, 1);
            i--;
        } else if ( !rooms[waitingRooms[i]].friendRoom ){
            openRoomID = waitingRooms.splice(i, 1);
            break
        }
    }

    if (openRoomID){
        res.json({roomID: openRoomID});
    } else if (Object.keys(rooms).length >= MAX_ROOMS){
        res.json({roomID: null});
        return
    } else {
        waitingRooms.push(roomCount);
        res.json({roomID: roomCount})
    }

    console.log("waitingRooms", waitingRooms)
    
})

server.listen(port);
console.log('Connected');