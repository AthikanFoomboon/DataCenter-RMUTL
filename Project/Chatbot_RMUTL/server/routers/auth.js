const express = require('express');

const routes = express.Router();


routes.post('/login', require('../controllers/auth').Login);

module.exports = routes;
    
