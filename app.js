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

// contains objects like {p1: {pid, isWhite, disconnected}, p2: {pid, isWhite, disconnected}, friendRoom: boolean}
// index by room ID
let rooms = {};

// contains IDs for rooms with only one player
let waitingRooms = []

let roomCount = 0;
let playerCount = 0;

const MAX_ROOMS = 50;

function getFreeRoom(){
    if (process.env.DEBUG) console.log("call to /getOpenRoom")
    if (process.env.DEBUG) console.log("waitingRooms", waitingRooms)
    
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
        if (process.env.DEBUG) console.log("waitingRooms", waitingRooms)
        return openRoomID[0]
    } else if (Object.keys(rooms).length >= MAX_ROOMS){
        if (process.env.DEBUG) console.log("waitingRooms", waitingRooms)
        return null
    } else {
        waitingRooms.push(roomCount);
        if (process.env.DEBUG) console.log("waitingRooms", waitingRooms)
        return roomCount
    }

}

function checkAlreadyInRoom(pid){
    for (const key in rooms){
        if (rooms[key].p1.pid == pid || (rooms[key].p2 && rooms[key].p2.pid == pid)){
            return key;
        }
    }
    return null;
}

io.on('connection', function (socket) {
    let playerID;
    let thisRoomID = undefined;
    
    socket.on('joined', ({roomID, friendRoom, playerID: givenID}) => {
        console.log("player", givenID, "joined room", roomID);
        
        thisRoomID = roomID;
        if (thisRoomID == null) {
            if (givenID != undefined){
                alreadyInRoom = checkAlreadyInRoom(givenID);
                if (alreadyInRoom != null){
                    thisRoomID = alreadyInRoom;
                    if (rooms[thisRoomID].p1.pid == givenID){
                        rooms[thisRoomID].p1.disconnected = false;
                    } else if (rooms[thisRoomID].p2.pid == givenID) {
                        rooms[thisRoomID].p2.disconnected = false;
                    } else {
                        console.log("error with checkAlreadyInRoom")
                    }
                } else {
                    thisRoomID = getFreeRoom();
                }
            } else {
                thisRoomID = getFreeRoom();
            }
        }

        if (givenID == undefined){
            playerID = playerCount;
            playerCount++;
        } else {
            playerID = givenID;
        }
        
        if (process.env.DEBUG) console.log("final roomID", thisRoomID)

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

            if (process.env.DEBUG) console.log("emitting twoPlayers", thisRoomID)
            socket.emit("twoPlayers", thisRoomID)
            socket.broadcast.emit("twoPlayers", thisRoomID)
        } else {
            if (rooms[thisRoomID].p1.pid == playerID){
                socket.broadcast.emit("needReconnectData", {roomID: thisRoomID, pid: playerID});
                socket.emit("partialReconnect", {roomID: thisRoomID, pid: playerID, isWhite: rooms[thisRoomID].p1.isWhite})
                rooms[thisRoomID].p1.disconnected = false;
            } else if (rooms[thisRoomID].p2.pid == playerID){
                socket.broadcast.emit("needReconnectData", {roomID: thisRoomID, pid: playerID});
                socket.emit("partialReconnect", {roomID: thisRoomID, pid: playerID, isWhite: rooms[thisRoomID].p2.isWhite})
                rooms[thisRoomID].p2.disconnected = false;
            } else {
                if (process.env.DEBUG) console.log("attempting to join full room, player", playerID)
                socket.emit("fullRoom")
                return
            }
        }

        console.log("rooms", rooms)
        
    });
    
    socket.on('reconnectData', args=>{
        socket.broadcast.emit("establishReconnection", {...args, roomID: thisRoomID, pid: playerID})
    })

    socket.on("admitDefeat", ()=>{
        let thisRoom = rooms[thisRoomID];
                
        if (thisRoom && thisRoom.p1 && thisRoom.p2) {
            if (thisRoom.p1.pid == playerID){
                socket.broadcast.emit('gameOver', {room: thisRoomID, id: thisRoom.p2.pid});
                delete rooms[thisRoomID]
            } else if (thisRoom.p2.pid == playerID){
                socket.broadcast.emit('gameOver', {room: thisRoomID, id: thisRoom.p1.pid});
                delete rooms[thisRoomID]
            }
        } else if (thisRoom){
            delete rooms[thisRoomID]
        }

        console.log("rooms", rooms)
    })

    socket.on('disconnect', () => {

        if (rooms[thisRoomID]){
            console.log(playerID + ' disconnected');
            
            if (rooms[thisRoomID].p1.pid == playerID){
                rooms[thisRoomID].p1.disconnected = true;
            } else if (rooms[thisRoomID].p2.pid == playerID){
                rooms[thisRoomID].p2.disconnected = true;
            } else {
                console.log("wrong room???")
            }

            if (process.env.DEBUG) console.log("rooms", rooms)
            
            if (
                rooms[thisRoomID].p1 && 
                rooms[thisRoomID].p1.disconnected && 
                rooms[thisRoomID].p2 && 
                rooms[thisRoomID].p2.disconnected
            ) {
                delete rooms[thisRoomID]
                console.log("rooms", rooms)
            } else {
                setTimeout(()=>{
                    if (process.env.DEBUG) console.log("player", playerID, "timed out")
                    let thisRoom = rooms[thisRoomID];
                    
                    if (thisRoom && thisRoom.p1 && thisRoom.p2) {
                        if (thisRoom.p1.pid == playerID && thisRoom.p1.disconnected){
                            socket.broadcast.emit('gameOver', {room: thisRoomID, id: thisRoom.p2.pid});
                            delete rooms[thisRoomID]
                        } else if (thisRoom.p2.pid == playerID && thisRoom.p2.disconnected){
                            socket.broadcast.emit('gameOver', {room: thisRoomID, id: thisRoom.p1.pid});
                            delete rooms[thisRoomID]
                        }
                    } else if (thisRoom){
                        delete rooms[thisRoomID]
                    }
    
                    console.log("rooms", rooms)
                }, 30000)
            }

    
        }

        
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