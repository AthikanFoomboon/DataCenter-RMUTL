const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Dynamically load all routers in ./routers and mount them by filename (e.g. auth.js -> /auth)
const routersDir = path.join(__dirname, 'routers');
fs.readdirSync(routersDir)
  .filter((file) => file.endsWith('.js'))
  .forEach((file) => {
    const router = require(path.join(routersDir, file));
    if (typeof router === 'function' || (router && typeof router.handle === 'function')) {
      app.use('/api', router);
    } else {
      console.warn(`Skipped mounting ${file}: module did not export a router`);
    }
  });

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
