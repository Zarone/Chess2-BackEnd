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

const MAX_ROOMS = 25;

function getFreeRoom(){
    console.log("call to /getOpenRoom")
    console.log("waitingRooms", waitingRooms)
    
    let openRoomID = undefined;

    for (let i = 0; i < waitingRooms.length; i++){
        if ( !rooms[waitingRooms[i]] || rooms[waitingRooms[i]].p2 ){
            waitingRooms.splice(i, 1);
            i--;
        } else if ( !rooms[waitingRooms[i]].friendRoom ){
            openRoomID = waitingRooms.splice(i, 1);
            break
        }
    }

    if (openRoomID){
        console.log("waitingRooms", waitingRooms)
        return openRoomID[0]
    } else if (Object.keys(rooms).length >= MAX_ROOMS){
        console.log("waitingRooms", waitingRooms)
        return null
    } else {
        waitingRooms.push(roomCount);
        console.log("waitingRooms", waitingRooms)
        return roomCount
    }

}

io.on('connection', function (socket) {
    let playerID =  Math.floor((Math.random() * 100) + 1)
    let thisRoomID = undefined;
    
    console.log(playerID + ' connected');

    socket.on('joined', ({roomID, friendRoom}) => {
        console.log("player joined room", roomID);
        
        thisRoomID = roomID;
        if (thisRoomID == null) thisRoomID = getFreeRoom();

        console.log("final roomID", thisRoomID)

        if (Object.keys(rooms).length >= MAX_ROOMS && rooms[thisRoomID] == undefined){
            socket.emit("maximumPlayers")
            return
        } else if (rooms[thisRoomID] == undefined){
            rooms[thisRoomID] = {friendRoom}
            roomCount++;
        }

        // if this is the first player to join the room
        if (rooms[thisRoomID].p1 == undefined){
            rooms[thisRoomID].p1 = { pid: playerID, isWhite: true };

            socket.emit('player', {...rooms[thisRoomID].p1, roomID: thisRoomID, } )
        } else if (rooms[thisRoomID].p2 == undefined){
            
            if (playerID == rooms[thisRoomID].p1.pid){
                playerID++;
            }

            rooms[thisRoomID].p2 = { pid: playerID, isWhite: false };

            socket.emit('player', {...rooms[thisRoomID].p2, roomID: thisRoomID} )

            console.log("emitting twoPlayers", thisRoomID)
            socket.emit("twoPlayers", thisRoomID)
            socket.broadcast.emit("twoPlayers", thisRoomID)
        } else {
            console.log("attempting to join full room, player", playerID)
            socket.emit("fullRoom")
            return
        }

        console.log("rooms", rooms)
        
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
        socket.broadcast.emit("registeredMove", args)
    })

});

app.get("/getRoomCount", (req, res)=>{
    res.json({roomCount: Object.keys(rooms).length.toString() + "/" + MAX_ROOMS.toString()})
})

server.listen(port);
console.log('Connected');