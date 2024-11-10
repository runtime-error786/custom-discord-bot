const express = require('express');
const cors = require('cors');

function startServer(app) {
  const port = process.env.PORT || 3000;

  app.use(cors()); 

  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

module.exports = { startServer };
