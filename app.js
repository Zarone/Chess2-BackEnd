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
        origin: process.env.CLIENT || ["http://localhost:5500", "http://127.0.0.1:5500"],
        methods: ["GET", "POST"],
        transports: ['websocket', 'polling'],
        credentials: true
    },
    allowEIO3: true
});

// contains objects like {p1: {pid, isWhite, disconnected, time}, p2: {pid, isWhite, disconnected, time}, friendRoom: boolean, timeOfLastMove, timeLimit}
// index by room ID
let rooms = {};

// contains IDs for rooms with only one player
let waitingRooms = []

let roomCount = 0;
let playerCount = 0;
let usedPlayerIds = {};

let getNextUnusedPlayerID = () => {
    let playerID = playerCount;
    while ( usedPlayerIds[playerID] ) playerID = ++playerCount;
    return playerID;
};

const MAX_ROOMS = 50;

function getFreeRoom(timeLimit){
    if (process.env.DEBUG) console.log("call to /getOpenRoom")
    if (process.env.DEBUG) console.log("waitingRooms", waitingRooms)
    
    let openRoomID = undefined;

    for (let i = 0; i < waitingRooms.length; i++){
        // if room has a player 2 or no longer exists, remove it from waitingRooms
        if ( !rooms[waitingRooms[i]] || rooms[waitingRooms[i]].p2 ){
            waitingRooms.splice(i, 1);
            i--;
        } else if ( !rooms[waitingRooms[i]].friendRoom && rooms[waitingRooms[i]].timeLimit == timeLimit ){
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
        if ((rooms[key].p1 && rooms[key].p1.pid == pid && rooms[key].p1.disconnected) || (rooms[key].p2 && rooms[key].p2.pid == pid && rooms[key].p2.disconnected)){
            return key;
        }
    }
    return null;
}

io.on('connection', function (socket) {
    let playerID;
    let thisRoomID = undefined;
    
    socket.on('joined', ({roomID, friendRoom, playerID: givenID, timeLimit, spectator}) => {
        console.log("player", givenID, "joined room", roomID);
        
        thisRoomID = roomID;
        if (thisRoomID == null) {
            if (givenID != undefined){
                let alreadyInRoom = checkAlreadyInRoom(givenID);
                if (alreadyInRoom != null){
                    thisRoomID = alreadyInRoom;
                    // if (rooms[thisRoomID].p1.pid == givenID){
                    //     rooms[thisRoomID].p1.disconnected = false;
                    //     console.log("p1 = false, top")
                    // } else if (rooms[thisRoomID].p2.pid == givenID) {
                    //     rooms[thisRoomID].p2.disconnected = false;
                    //     console.log("p2 = false, top")
                    // } else {
                    //     console.log("error with checkAlreadyInRoom")
                    // }
                } else {
                    thisRoomID = getFreeRoom(timeLimit);
                }
            } else {
                thisRoomID = getFreeRoom(timeLimit);
            }
        }

        if (givenID == undefined){
            playerID = getNextUnusedPlayerID();
        } else {
            // TODO: session token to verify
            usedPlayerIds[givenID] = true;
            playerID = givenID;
        }
        
        if (process.env.DEBUG) console.log("final roomID", thisRoomID)

        if (
            Object.keys(rooms).length >= MAX_ROOMS
            && rooms[thisRoomID] == undefined
            && ! spectator
        ){
            socket.emit("maximumPlayers")
            return
        } else if (rooms[thisRoomID] == undefined){
            rooms[thisRoomID] = {friendRoom, timeLimit}
            roomCount++;
        }

        if ( spectator ) {
            if ( ! rooms[thisRoomID].spectators ) rooms[thisRoomID].spectators = [];
            console.log(`[SPECTATOR(${playerID})] sending initial board state`);
            const spectators = rooms[thisRoomID].spectators;
            if ( ! spectators.includes(playerID) ) spectators.push(playerID);
            socket.broadcast.emit("needReconnectData", {roomID: thisRoomID, pid: playerID, spectator: true});
            socket.emit("partialReconnect", {roomID: thisRoomID, pid: playerID, isWhite: rooms[thisRoomID].p2 && rooms[thisRoomID].p2.isWhite, timeLimit: rooms[thisRoomID].timeLimit})
            return;
        }

        // if this is the first player to join the room
        if (rooms[thisRoomID].p1 == undefined){
            rooms[thisRoomID].p1 = { pid: playerID, isWhite: true, time: null };

            socket.emit('player', {...rooms[thisRoomID].p1, roomID: thisRoomID } )
        } else if (rooms[thisRoomID].p2 == undefined){
            
            if (playerID == rooms[thisRoomID].p1.pid){
                playerID++;
                playerCount++;
            }

            rooms[thisRoomID].p2 = { pid: playerID, isWhite: false, time: null };

            socket.emit('player', {...rooms[thisRoomID].p2, roomID: thisRoomID} )

            if (process.env.DEBUG) console.log("emitting twoPlayers", thisRoomID)
            socket.emit("twoPlayers", {finalTimeLimit: rooms[thisRoomID].timeLimit, thisRoomID})
            socket.broadcast.emit("twoPlayers", {finalTimeLimit: rooms[thisRoomID].timeLimit, thisRoomID})
            rooms[thisRoomID].timeOfLastMove = new Date();
            rooms[thisRoomID].p2.time = 0;
            rooms[thisRoomID].p1.time = 0;
        } else {
            // debugger
            if (rooms[thisRoomID].p1.pid == playerID && rooms[thisRoomID].p1.disconnected){
                socket.broadcast.emit("needReconnectData", {roomID: thisRoomID, pid: playerID});
                socket.emit("partialReconnect", {roomID: thisRoomID, pid: playerID, isWhite: rooms[thisRoomID].p1.isWhite, timeLimit: rooms[thisRoomID].timeLimit})
                rooms[thisRoomID].p1.disconnected = false;
                console.log("p1 = false")
            } else if (rooms[thisRoomID].p2.pid == playerID && rooms[thisRoomID].p2.disconnected){
                socket.broadcast.emit("needReconnectData", {roomID: thisRoomID, pid: playerID});
                socket.emit("partialReconnect", {roomID: thisRoomID, pid: playerID, isWhite: rooms[thisRoomID].p2.isWhite, timeLimit: rooms[thisRoomID].timeLimit})
                rooms[thisRoomID].p2.disconnected = false;
                console.log("p2 = false")
            } else {
                if (process.env.DEBUG) console.log("attempting to join full room, player", playerID)
                thisRoomID = null
                socket.emit("fullRoom")
                return
            }
        }

        console.log("rooms", rooms)
        
    });
    
    socket.on('reconnectData', args=>{

        if (!rooms[thisRoomID]) return;

        let timeSinceLastMove = Math.abs(new Date() - rooms[thisRoomID].timeOfLastMove)/1000

        socket.broadcast.emit("establishReconnection", {
            ...args, 
            roomID: thisRoomID, 
            pid: playerID, 
            timeWhite: rooms[thisRoomID].p1 && rooms[thisRoomID].p2 && rooms[thisRoomID].p1.isWhite ? 
                rooms[thisRoomID].p1.time :
                rooms[thisRoomID].p2.time,
            timeBlack: !rooms[thisRoomID].p1 && rooms[thisRoomID].p2 && rooms[thisRoomID].isWhite ? 
                rooms[thisRoomID].p1.time :
                rooms[thisRoomID].p2.time,
            timeSinceLastMove
        })
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
            
            if (rooms[thisRoomID] && rooms[thisRoomID].p1.pid == playerID){
                rooms[thisRoomID].p1.disconnected = true;
            } else if (rooms[thisRoomID].p2 && rooms[thisRoomID].p2.pid == playerID){
                rooms[thisRoomID].p2.disconnected = true;
            } else {
                console.log("wrong room or spectator disconnected")
                return;
            }

            if (process.env.DEBUG) console.log("rooms", rooms)
            
            if (
                !rooms[thisRoomID].p2 ||
                (
                    rooms[thisRoomID].p1 && 
                    rooms[thisRoomID].p1.disconnected && 
                    rooms[thisRoomID].p2 && 
                    rooms[thisRoomID].p2.disconnected
                )
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
        if (rooms[args.room]){
            if (rooms[args.room].timeLimit < 60){
                if (process.env.DEBUG) console.log("rooms", rooms)
        
                if (rooms[args.room].p1.pid == args.player){
                    rooms[args.room].p1.time += Math.abs(new Date() - rooms[args.room].timeOfLastMove)/1000
                } else if (rooms[args.room].p2.pid == args.player){
                    rooms[args.room].p2.time += Math.abs(new Date() - rooms[args.room].timeOfLastMove)/1000
                }
                rooms[args.room].timeOfLastMove = new Date()
                if (process.env.DEBUG) console.log("rooms", rooms)
            }
    
            socket.broadcast.emit("registeredMove", args)
        }
    })

});

app.get("/getRoomCount", (req, res)=>{
    res.json({roomCount: Object.keys(rooms).length.toString() + "/" + MAX_ROOMS.toString()})
})

server.listen(port);
console.log('Connected to port', port); 