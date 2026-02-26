require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const db = require('./models');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST', 'PUT', 'DELETE']
    }
});
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('io', io);
app.use('/frontend', express.static(path.join(__dirname, '..', 'frontend')));
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/expenses', require('./routes/expense.routes'));
app.get('/api', (req, res) => {
    res.json({ message: 'Welcome to Expense Tracker API' });
});
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join', (userId) => {
        socket.join(`user_${userId}`);
        console.log(`User ${userId} joined their room`);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});
const PORT = process.env.PORT || 5000;

db.sequelize.sync()
    .then(() => {
        console.log('Database synced successfully');
        server.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
            console.log(`API: http://localhost:${PORT}/api`);
        });
    })
    .catch((err) => {
        console.error('Failed to sync database:', err);
    });