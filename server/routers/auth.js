const express = require('express');
const {loginMicrosoftStart,microsoftAuth } = require('../controllers/loginMicrosoft');

const routes = express.Router();

// Start MS login + redirect
routes.post('/loginMicrosoft', loginMicrosoftStart);
routes.get('/auth/microsoft', microsoftAuth);

//CRUD
routes.put('/updateUser', (req, res) => {
  res.json({ message: 'User updated successfully' });
})
routes.delete('/deleteUser', (req, res) => {
  res.json({ message: 'User deleted successfully' });
})
routes.get('/getUser', (req, res) => {
  res.json({ message: 'User information retrieved successfully' });
});

module.exports = routes;
    
