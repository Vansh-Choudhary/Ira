from flask import Flask, render_template, request, jsonify
import os
import google.generativeai as genai
import firebase_admin
from firebase_admin import credentials, firestore

app = Flask(__name__)

# Set the API key as an environment variable
os.environ["GEMINI_API_KEY"] = "AIzaSyBt50eoRnb-R1BummegUTqeX2l7ieNmWkM"

# Configure the Gemini API with the API key
genai.configure(api_key=os.environ["GEMINI_API_KEY"])

# Firebase setup
cred = credentials.Certificate("/Users/vansh/Downloads/Gemini-timepass/chatbot-c5473-firebase-adminsdk-ly5c9-89d682d760.json")
firebase_admin.initialize_app(cred)
db = firestore.client()

def load_conversation_history_from_firebase(user_name):
    history_ref = db.collection('conversation_history').document(user_name)
    doc = history_ref.get()
    if doc.exists:
        return doc.to_dict().get('history', [])
    return []

def save_conversation_to_firebase(user_name, user_input, response_text):
    history_ref = db.collection('conversation_history').document(user_name)
    history = load_conversation_history_from_firebase(user_name)
    history.append({"user_input": user_input, "response_text": response_text})
    history_ref.set({'history': history})

def clear_conversation_history_in_firebase(user_name):
    history_ref = db.collection('conversation_history').document(user_name)
    history_ref.delete()

def convert_history_to_gemini_format(history):
    gemini_history = []
    for entry in history:
        gemini_history.append({"parts": [{"text": entry["user_input"]}], "role": "user"})
        gemini_history.append({"parts": [{"text": entry["response_text"]}], "role": "model"})
    return gemini_history

def summarize_conversation_history(user_name):
    conversation_history = load_conversation_history_from_firebase(user_name)
    gemini_history = convert_history_to_gemini_format(conversation_history)
    
    if not gemini_history:
        return "No conversation history found to summarize."
    generation_config = {
        "temperature": 0.2,
        "top_p": 0.95,
        "top_k": 70,
        "max_output_tokens": 5000,
        "response_mime_type": "text/plain",
    }
    safety_settings = [
        {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
        {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
        {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
        {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
    ]
    summary_instruction = "Summarize the chat of only the user do not include the model's response, call the model by the name ira."
    model = genai.GenerativeModel(
        model_name="gemini-1.5-flash",
        safety_settings=safety_settings,
        generation_config=generation_config,
        system_instruction=summary_instruction,
    )

    chat_session = model.start_chat(history=gemini_history)
    summary_response = chat_session.send_message("Summarize the chat of only the user do not include the model's response, call the model by the name ira.")
    
    return summary_response.text.strip()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/chat', methods=['POST'])
def chat():
    user_name = request.form['user_name']
    user_input = request.form['user_input']
    
    print(f"Received message from {user_name}: {user_input}")  # Debug statement

    generation_config = {
        "temperature": 0.5,
        "top_p": 0.95,
        "top_k": 70,
        "max_output_tokens": 75,
        "response_mime_type": "text/plain",
    }
    safety_settings = [
        {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
        {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
        {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
        {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
    ]

    system_instruction = f"your name is ira, you're best friend is {user_name}, you work as someone who talks to {user_name} about their day and remember everything, you are like a virtual diary journal for them, you have to be very comforting so {user_name} can tell you everything about their life and their day. you have to get to know {user_name} very well by asking them everything about their life. you can speak english and hinglish both. You talk to them everyday and remember what happened today then use that memory to solve any problem they have in the future by using some post incident or memory they told you about, also never start repeating responses"

    model = genai.GenerativeModel(
        model_name="gemini-1.5-flash",
        safety_settings=safety_settings,
        generation_config=generation_config,
        system_instruction=system_instruction,
    )

    conversation_history = load_conversation_history_from_firebase(user_name)
    gemini_history = convert_history_to_gemini_format(conversation_history)
    chat_session = model.start_chat(history=gemini_history)

    if user_input.lower() == 'clear memory':
        clear_conversation_history_in_firebase(user_name)
        response_text = "Memory cleared."
    elif user_input.lower() == 'history':
        response_text = summarize_conversation_history(user_name)
    else:
        response = chat_session.send_message(user_input)
        save_conversation_to_firebase(user_name, user_input, response.text)
        response_text = response.text.strip()
    
    print(f"Response to {user_name}: {response_text}")  # Debug statement

    return jsonify({"response": response_text})

if __name__ == '__main__':
    app.run(debug=True)
