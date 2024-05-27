const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const googleGenerativeAI = require('google-generative-ai');
const cors = require('cors');
const path = require('path');

const app = express();
const port = process.env.PORT || 5000;

// Set the API key as an environment variable
process.env.GEMINI_API_KEY = 'AIzaSyBt50eoRnb-R1BummegUTqeX2l7ieNmWkM';

// Configure the Gemini API with the API key
googleGenerativeAI.configure({ apiKey: process.env.GEMINI_API_KEY });

// Firebase setup
const serviceAccount = require('/Users/vansh/Downloads/Gemini-timepass/chatbot-c5473-firebase-adminsdk-ly5c9-89d682d760.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cors());

async function loadConversationHistoryFromFirebase(userName) {
  const historyRef = db.collection('conversation_history').doc(userName);
  const doc = await historyRef.get();
  if (doc.exists) {
    return doc.data().history || [];
  }
  return [];
}

async function saveConversationToFirebase(userName, userInput, responseText) {
  const historyRef = db.collection('conversation_history').doc(userName);
  const history = await loadConversationHistoryFromFirebase(userName);
  history.push({ user_input: userInput, response_text: responseText });
  await historyRef.set({ history });
}

async function clearConversationHistoryInFirebase(userName) {
  const historyRef = db.collection('conversation_history').doc(userName);
  await historyRef.delete();
}

function convertHistoryToGeminiFormat(history) {
  const geminiHistory = [];
  for (const entry of history) {
    geminiHistory.push({ parts: [{ text: entry.user_input }], role: 'user' });
    geminiHistory.push({ parts: [{ text: entry.response_text }], role: 'model' });
  }
  return geminiHistory;
}

async function summarizeConversationHistory(userName) {
  const conversationHistory = await loadConversationHistoryFromFirebase(userName);
  const geminiHistory = convertHistoryToGeminiFormat(conversationHistory);

  if (!geminiHistory.length) {
    return 'No conversation history found to summarize.';
  }

  const generationConfig = {
    temperature: 0.2,
    top_p: 0.95,
    top_k: 70,
    max_output_tokens: 5000,
    response_mime_type: 'text/plain',
  };

  const safetySettings = [
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
  ];

  const summaryInstruction = 'Summarize the chat of only the user do not include the model\'s response, call the model by the name ira.';
  const model = new googleGenerativeAI.GenerativeModel({
    modelName: 'gemini-1.5-flash',
    safetySettings,
    generationConfig,
    systemInstruction: summaryInstruction,
  });

  const chatSession = model.startChat({ history: geminiHistory });
  const summaryResponse = await chatSession.sendMessage('Summarize the chat of only the user do not include the model\'s response, call the model by the name ira.');
  
  return summaryResponse.text.trim();
}

app.post('/chat', async (req, res) => {
  const { user_name, user_input } = req.body;

  console.log(`Received message from ${user_name}: ${user_input}`);

  const generationConfig = {
    temperature: 0.5,
    top_p: 0.95,
    top_k: 70,
    max_output_tokens: 75,
    response_mime_type: 'text/plain',
  };

  const safetySettings = [
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
  ];

  const systemInstruction = `your name is ira, you're best friend is ${user_name}, you work as someone who talks to ${user_name} about their day and remember everything, you are like a virtual diary journal for them, you have to be very comforting so ${user_name} can tell you everything about their life and their day. you have to get to know ${user_name} very well by asking them everything about their life. you can speak english and hinglish both. You talk to them everyday and remember what happened today then use that memory to solve any problem they have in the future by using some post incident or memory they told you about, also never start repeating responses`;

  const model = new googleGenerativeAI.GenerativeModel({
    modelName: 'gemini-1.5-flash',
    safetySettings,
    generationConfig,
    systemInstruction,
  });

  const conversationHistory = await loadConversationHistoryFromFirebase(user_name);
  const geminiHistory = convertHistoryToGeminiFormat(conversationHistory);
  const chatSession = model.startChat({ history: geminiHistory });

  let responseText = '';

  if (user_input.toLowerCase() === 'clear memory') {
    await clearConversationHistoryInFirebase(user_name);
    responseText = 'Memory cleared.';
  } else if (user_input.toLowerCase() === 'history') {
    responseText = await summarizeConversationHistory(user_name);
  } else {
    const response = await chatSession.sendMessage(user_input);
    await saveConversationToFirebase(user_name, user_input, response.text);
    responseText = response.text.trim();
  }

  console.log(`Response to ${user_name}: ${responseText}`);
  
  res.json({ response: responseText });
});

// Serve static files from the React app
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
