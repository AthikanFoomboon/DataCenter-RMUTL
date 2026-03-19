const express = require('express');
const routes = express.Router();

routes.get('/hello', (_req, res) => {
  res.json({ message: 'Hello world' });
});


module.exports = routes;
    
