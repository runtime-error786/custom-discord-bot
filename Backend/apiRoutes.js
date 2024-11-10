const express = require('express');
const router = express.Router();
const { chatApi } = require('./Controller/scraperController'); 

router.post('/chat', chatApi);

module.exports = router;
