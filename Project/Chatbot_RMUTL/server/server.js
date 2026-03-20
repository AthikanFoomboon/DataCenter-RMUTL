require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Dynamically load all routers in ./routers and let each router define its own paths
const routersDir = path.join(__dirname, 'routers');
fs.readdirSync(routersDir)
  .filter((file) => file.endsWith('.js'))
  .forEach((file) => {
    const router = require(path.join(routersDir, file));
    if (typeof router === 'function' || (router && typeof router.handle === 'function')) {
      // Mount without auto prefix so routes control their own paths
      app.use(router);
      console.log(`Mounted router from ${file} without prefix`);
    } else {
      console.warn(`Skipped mounting ${file}: module did not export a router`);
    }
  });

const PORT = process.env.PORT 

app.listen(PORT, () => {
  console.log(`Server running PORT ${PORT}`);
});
