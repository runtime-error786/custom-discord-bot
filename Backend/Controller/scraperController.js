const {
  CheerioWebBaseLoader,
} = require("@langchain/community/document_loaders/web/cheerio");
const { RecursiveCharacterTextSplitter } = require("langchain/text_splitter");
const {
  HuggingFaceTransformersEmbeddings,
} = require("@langchain/community/embeddings/hf_transformers");
const { client, connect } = require("../Model/astradbModel");
const allowedUrls = require("../utils/allowedUrls");
const { v4: uuidv4 } = require("uuid");
const cosineSimilarity = require("compute-cosine-similarity");
const { ChatGroq } = require("@langchain/groq");

require("dotenv").config();

const llm = new ChatGroq({
  apiKey: process.env.groq_api_key,
  model: "mixtral-8x7b-32768",
  temperature: 0.5,
});

const embeddings = new HuggingFaceTransformersEmbeddings({
  model: "Xenova/all-MiniLM-L6-v2",
});

async function scrapeText() {
  let combinedText = "";
  for (const url of allowedUrls) {
    const loader = new CheerioWebBaseLoader(url, { selector: "body" });
    const docs = await loader.load();

    if (docs.length === 0) {
      console.error(`No content found on ${url}`);
      continue;
    }

    const text = docs
      .map((doc) => doc.pageContent.trim())
      .join(" ")
      .replace(/\s+/g, " ")
      .replace(/^\s+|\s+$/g, "");

    combinedText += text + " ";
  }

  return combinedText.trim();
}

async function embedAndStoreText(text) {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });
  const chunks = await splitter.splitText(text);

  const insertQuery = `INSERT INTO default_keyspace.text_embeddings (chunk_id, text, embedding) VALUES (?, ?, ?)`;

  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index];

    try {
      const response = await embeddings.embedDocuments([chunk]);

      const embedding = Array.isArray(response) ? response[0] : [];

      if (embedding && Array.isArray(embedding)) {
        const chunkId = uuidv4();

        await client.execute(insertQuery, [chunkId, chunk, embedding], {
          prepare: true,
        });
        console.log(`Inserted chunk ${index + 1} successfully.`);
      } else {
        console.error("Embedding format error, expected an array of floats.");
      }
    } catch (error) {
      console.error(
        "Error in embedding or inserting chunk into AstraDB:",
        error
      );
    }
  }
}

async function checkIfDataExists() {
  const query = "SELECT count(*) FROM default_keyspace.text_embeddings";
  try {
    const result = await client.execute(query);
    const count = result.rows[0]["count"];
    return count > 0;
  } catch (error) {
    console.error("Error checking table data:", error);
    return false;
  }
}

async function retrieveRelevantDocuments(queryText) {
  const embeddingResponse = await embeddings.embedDocuments([queryText]);
  const queryEmbedding = embeddingResponse[0];

  const selectQuery = `SELECT chunk_id, text, embedding FROM default_keyspace.text_embeddings`;

  try {
    const result = await client.execute(selectQuery);
    const documents = result.rows;

    const similarityResults = documents
      .map((doc) => {
        const docEmbedding = doc.embedding;

        if (Array.isArray(queryEmbedding) && Array.isArray(docEmbedding)) {
          const similarity = cosineSimilarity(queryEmbedding, docEmbedding);
          return { chunk_id: doc.chunk_id, text: doc.text, similarity };
        } else {
          console.error("Invalid embedding format.");
          return null;
        }
      })
      .filter((result) => result !== null);

    const sortedResults = similarityResults.sort(
      (a, b) => b.similarity - a.similarity
    );

    return sortedResults.slice(0, 5);
  } catch (error) {
    console.error("Error retrieving relevant documents:", error);
    return [];
  }
}

async function saveConversation(userId, role, message) {
  const insertQuery = `INSERT INTO default_keyspace.conversations (user_id, timestamp, role, message) VALUES (?, toTimestamp(now()), ?, ?)`;
  await client.execute(insertQuery, [userId, role, message], { prepare: true });
}

async function getConversationHistory(userId) {
  const selectQuery = `SELECT role, message FROM default_keyspace.conversations WHERE user_id = ? ORDER BY timestamp ASC`;
  const result = await client.execute(selectQuery, [userId], { prepare: true });
  return result.rows.map(row => ({ role: row.role, content: row.message }));
}

exports.chatApi = async (req, res) => {
  try {
    const userId = req.body.userId || uuidv4(); // Assume `userId` is passed, otherwise generate one
    console.log(userId);
    const dataExists = await checkIfDataExists();
    connect();
    if (!dataExists) {
      console.log("No data found, scraping and storing new data...");
      const text = await scrapeText();
      await embedAndStoreText(text);
    }

    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ error: "Query is required." });
    }

    const relevantDocs = await retrieveRelevantDocuments(query);
    if (relevantDocs.length === 0) {
      return res.status(200).json({ answer: "I don't know." });
    }

    const context = relevantDocs.map((doc) => doc.text).join("\n");

    const conversationHistory = await getConversationHistory(userId);

    const systemPrompt = `
      You are an assistant designed to answer questions specifically about Formula 1 racing cars, drivers, constructors, races, and related topics based only on the context provided below.
      Please use the relevant documents provided in the "Context" section to answer the question in the "Question" section. If the information is not available in the context, respond with: "I don't know."
      
      \n\nContext:\n{context}
      
      \n\nQuestion: {input}
      
      Answer:`;

    const prompt = systemPrompt
      .replace("{context}", context)
      .replace("{input}", query);

    const messages = [
      ...conversationHistory, // Include past conversation history
      { role: "system", content: prompt },
      { role: "user", content: query },
    ];

    const response = await llm.invoke(messages);

    await saveConversation(userId, "user", query);
    await saveConversation(userId, "assistant", response.text); 

    res.json({ answer: response.text });
  } catch (error) {
    console.error("Error in chat API:", error);
    res.status(500).json({ error: "Failed to process the request." });
  }
};