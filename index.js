const express = require('express');
const app = express();
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const md5 = require('md5');

app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: ['https://cinerate.vercel.app'],
        methods: ['GET', 'POST'],
    }
})

const online = {};
const rooms = {};

function calculateWinner(guesses, target){
    // Initialize variables to track the closest guess and its difference
    let closestGuesses = [];
    let minDifference = Infinity;

    // Iterate through each guess
    guesses.forEach(guess => {
        // Calculate the difference between the guess and the target
        let difference = parseFloat(target) - parseFloat(guess.vote);

        // Check if the guess is not over the target and is closer than the current closest
        if (difference >= 0 && difference < minDifference) {
            // Update the minimum difference
            minDifference = difference;

            // Reset the closest guesses array with the current guess
            closestGuesses = [guess];
        } else if (difference >= 0 && difference === minDifference) {
            // If there's a tie in difference, add this guess to the closest guesses array
            closestGuesses.push(guess);
        }
    });

    // Return the array of closest guesses
    return closestGuesses;
}

io.on('connection', (socket) => {
    //add user socket id to online{}
    online[socket.id] = {
        id: socket.id,
        name: socket.id.substring(0, 5), 
        score: 0,
        turns: 0
    }

    //send user socket info on connection
    io.to(socket.id).emit('entry', online[socket.id]);

    //update homepage open rooms
    io.to(socket.id).emit('update_public_rooms', rooms);

    //update user name
    socket.on('update_name', ({ id, name }) => {
        //update name
        online[id].name = name;

        //send user socket info
        io.to(id).emit('entry', online[id]);

        //send notification
        io.to(id).emit('notification', {message: 'Name updated.'});
    })

    //client creates room
    socket.on('create_room', ({ id, password }) => {
        //create room ID
        const roomID = md5(id);

        //join room
        socket.join(roomID);

        //create room obj
        const room = { 
            id: roomID,
            password: password,
            active: false,
            host: online[id],
            players: [online[id]], 
            chat: [], 
            dealer: null,
            critMovie: null,
            movies: [],
            guesses: [],
            winners: []
        };

        //remove score
        online[id].score = 0;

        //add room to rooms{}
        rooms[roomID] = room;

        //update room
        io.in(id).emit('update_room', room);

        //update homepage open rooms
        io.emit('update_public_rooms', rooms);

        //update stage
        io.to(id).emit('update_stage', {stage: 'await-players'});

        //update notifcation
        io.to(id).emit('notification', {message: 'Room created.'});
    })

    //client join a room
    socket.on('join_room', ({ id, room, password}) => {
        
        //check if room valid length
        if(room.length !== 32){
            //invalid room
            io.to(id).emit('notification', {
                message: 'Invalid room.'
            });
            return;
        }
        
        //check if room exists
        if(rooms[room]){
            //room exists
            //check if game is active
            if(!rooms[room].active){
                //check if room has a password
                if(rooms[room].password === password){
                    //password matches
                    socket.join(room);

                    //push player into room           
                    rooms[room].players.push(online[id]);

                    online[id].score = 0;

                    //update room
                    io.in(room).emit('update_room', rooms[room]);

                    //update stage
                    io.to(id).emit('update_stage', {stage: 'await-players'});

                    //update notifcation
                    io.to(id).emit('notification', {message: 'Joined room.'});
                }else{
                    //password does not match
                    io.to(id).emit('notification', {
                        message: 'Invalid password.'
                    }); 
                }
            }else{
                //room already active
                io.to(id).emit('notification', {
                    message: 'Game already started.'
                }); 
            }

        }else{
            //room doesn't exist
            io.to(id).emit('notification', {
                message: 'Invalid room.'
            });
        }
    })

    //update user name
    socket.on('leave_room', ({ id, room }) => {
       //remove id from room
       for(let i = 0; i < room.players.length; i++){
        if(room.players[i].id === id){
            room.players.splice(i, 1);
        }
       }

       //check if room is empty
       if(room.players.length === 0){
        //disband room
        delete rooms[room.id];

       }else{
            //assign new host
            room.host = room.players[0];

            //update rooms{}
            rooms[room.id] = room;

            //send room notification
            io.in(room.id).emit('notification', {
                message: `New host assigned: ${room.players[0].name}`
            });
        }

        //update stage for user that left
        io.to(id).emit('update_stage', {stage: 'splash'});

       //update room
       io.in(room.id).emit('update_room', rooms[room.id]);

       //update homepage open rooms
       io.emit('update_public_rooms', rooms);
       
       //send user notification
       io.to(id).emit('notification', {
            message: 'Left room.'
        });
    });

    //start game
    socket.on('start_game', ({ id }) => {
        //activate game
        rooms[id].active = true;

        //assign random dealer
        let random = Math.floor(Math.random() * rooms[id].players.length);
        rooms[id].dealer = rooms[id].players[random];
        
         //update room
         io.in(id).emit('update_room', rooms[id]);
         
         //update stage
         io.in(id).emit('update_stage', {stage: 'assign-movie'});
         
         //update notifcation
         io.in(id).emit('notification', {message: 'Game started.'});
    });

    //movie selected
    socket.on('movie_selected', ({ room, movie }) => {
       //assign critMovie
       rooms[room].critMovie = movie;

       //push into movies[]
       rooms[room].movies.push(movie);

       //update room
       io.in(room).emit('update_room', rooms[room]);

       //update stage
       io.in(room).emit('update_stage', {stage: 'cast-vote'});
       
       //update notifcation
       io.in(room).emit('notification', {message: 'Movie selected. Cast Vote.'});
    });

    //cast vote
    socket.on('cast_vote', ({ id, room, vote}) => {
        //push user guess into guesses[]
        rooms[room].guesses.push({ user: online[id], vote });

        //check if all guesses are cast
        if(rooms[room].guesses.length === rooms[room].players.length){

            //calculate winner
            const winners = calculateWinner(rooms[room].guesses, rooms[room].critMovie.imdbRating);

            //update rooms[room]
            rooms[room].winners = winners;
            
            //update player scores
            if(winners[0] !== null){
                for(let i = 0; i < winners.length; i++){
                    for(let j = 0; j < rooms[room].players.length; j++){
                        if(winners[i].user.id === rooms[room].players[j].id){
                            rooms[room].players[j].score = rooms[room].players[j].score + 1;
                        }
                    }
                }
            }

            //update room
            io.in(room).emit('update_room', rooms[room]);

            //update stage
            io.in(room).emit('update_stage', {stage: 'round-over'});

            //update notifcation
            io.in(room).emit('notification', {message: 'Round over.'});
        }else{
            //update notifcation (private)
            socket.to(id).emit('notification', {message: 'Vote cast.'});
        }
    });

        //next round
        socket.on("next_round", ({ room }) => {
            //assign random dealer amongst lowest turns
            let low = null;
            let iteration;

            //iterate over players
            for(let i = 0; i < rooms[room].players.length; i++){
                //get lowest amount of turns
                if(!low){
                    //if low is not set, set it
                    low = rooms[room].players[i]
                    iteration = i;
                }else if(low.turns > rooms[room].players[i].turns){
                    //found new low
                    low = rooms[room].players[i];
                    iteration = i;
                }
            }
            //increment turn
            rooms[room].players[iteration].turns = rooms[room].players[iteration].turns + 1;
    
            //assign dealer to lowest turns
            rooms[room].dealer = low;
    
            //update room variables
            rooms[room].winners.splice(0, rooms[room].winners.length);
            rooms[room].guesses.splice(0, rooms[room].guesses.length);
            rooms[room].critMovie = null;
    
                        //update stage
                        io.in(room).emit('update_stage', {stage: 'assign-movie'});

            //update room
            io.in(room).emit('update_room', rooms[room]);
    
            //update notifcation
            io.in(room).emit('notification', {message: 'Next round.'});
        })

           //re-assign dealer
    socket.on("assign_dealer", ({ room }) => {
        //update stage
        io.in(room).emit("update_stage", {stage: 'assign-dealer'});

        //update notifcation
        io.in(room).emit("notification", {message: 'Dealer time expired.'});

        //add additional turn to player who forfeitted
        for(let i = 0; i < rooms[room].players.length; i++){
            if(rooms[room].dealer.id === rooms[room].players[i].id){
                rooms[room].players[i].turns = rooms[room].players[i].turns + 1;
                break;
            }
        }
        
        setTimeout(() => {
        //assign random dealer
        let low = null;
        let iteration;
        //iterate over players
        for(let i = 0; i < rooms[room].players.length; i++){
            //get lowest amount of turns
            if(!low){
                //if low is not set, set it
                low = rooms[room].players[i]
                iteration = i;
            }else if(low.turns > rooms[room].players[i].turns){
                //found new low
                low = rooms[room].players[i];
                iteration = i;
            }
        }
        //increment turn
        rooms[room].players[iteration].turns = rooms[room].players[iteration].turns + 1;

        //assign dealer to lowest turns
        rooms[room].dealer = low;
            
                    //update stage
                    io.in(room).emit("update_stage", {stage: 'assign-movie'});

            //update room
            io.in(room).emit("update_room", rooms[room]);

            //update notifcation
            io.in(room).emit("notification", {message: 'New dealer.'});
        }, 3000)
    });

        //game over
        socket.on('game_over', ({ room }) => {
            //update stage
            io.in(room).emit("update_stage", {stage: 'game-over'});
    
            //update notifcation
            io.in(room).emit("notification", {message: 'Game over.'});

            //remove game
            delete rooms[room];
        })

    //send message
    socket.on('send_message', ({ id, name, message }) => {
        //push message into room.chat[]
        rooms[id].chat.push({name, message});

        //remove old messages
        if(rooms[id].chat.length > 10){
            rooms[id].chat.shift();
        }

        //update room        
        io.in(id).emit('update_room', rooms[id]);
    });


    //disconnect
    socket.on('disconnect', () => {
        //remove user from online users
        delete online[socket.id];

        //remove user from any active games

        //check if user is a host
    });
});

const PORT = 3001;
server.listen(PORT, () => {
    console.log(`server listening on port ${PORT}`);
})