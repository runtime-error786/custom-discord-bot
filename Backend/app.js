// Import required modules
const express = require('express');
const cors = require('cors');
const { connect } = require('./Model/astradbModel'); 
const apiRoutes = require('./apiRoutes'); 
const bodyParser = require('body-parser');
const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");
require("dotenv").config();

const app = express();
const port = 3001;

// AstraDB connection
connect();

// Middleware
app.use(express.json());
app.use(cors());
app.use(bodyParser.json());

// Routes
app.use('/api', apiRoutes);

app.get('/', (req, res) => {
  res.send('AstraDB setup complete!');
});

// Start Express server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// Discord bot setup
const DISCORD_TOKEN = process.env.DISCORD_TOKEN; // Discord bot token
const API_URL = "http://localhost:3001/api/chat"; // Your Node.js API URL

// Initialize Discord client with necessary intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,              // Access guilds
    GatewayIntentBits.GuildMessages,       // Read messages in a guild
    GatewayIntentBits.MessageContent,      // Access message content
  ],
});


// Event listener for when the bot is ready
client.once("ready", () => {
  console.log("Discord bot is ready!");
});

// Handle messages in Discord
client.on("messageCreate", async (message) => {
  // Ignore messages from bots
  if (message.author.bot) return;

  // Check if the message starts with "!ask" command
  if (message.content.startsWith("!ask")) {
    const query = message.content.slice(5).trim(); // Extract the query after "!ask"

    if (!query) {
      message.reply("Please provide a question.");
      return;
    }

    try {
      // Send the query to your Node.js API
      const response = await axios.post(API_URL, { query, userId: message.author.id });
      const answer = response.data.answer || "I don't know.";

      // Reply in Discord with the API response
      message.reply(answer);
    } catch (error) {
      console.error("Error calling API:", error);
      message.reply("There was an error processing your request.");
    }
  }
});

// Log in to Discord with your bot token
client.login(DISCORD_TOKEN);
  