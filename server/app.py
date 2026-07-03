import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from google import genai
from google.genai import types
from dotenv import load_dotenv

# Load secret key from .env file
load_dotenv()

app = Flask(__name__)
CORS(app)  # Allow requests from your GitHub Pages frontend

# Initialize the official Gemini client
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

# Keep a simple in-memory session store (keyed by session_id)
sessions: dict[str, list] = {}

@app.route("/", methods=["GET"])
def health():
    return jsonify({"status": "Gemini Chatbot API is running ✅"})

@app.route("/api/ask", methods=["POST"])
def ask_gemini():
    data = request.get_json(silent=True)

    if not data or "prompt" not in data:
        return jsonify({"error": "Please provide a 'prompt' in the request body."}), 400

    user_prompt  = data["prompt"]
    session_id   = data.get("session_id", "default")
    model_name   = data.get("model", "gemini-2.0-flash")

    # Build conversation history for multi-turn chat
    history = sessions.get(session_id, [])
    history.append({"role": "user", "parts": [{"text": user_prompt}]})

    try:
        response = client.models.generate_content(
            model=model_name,
            contents=history,
            config=types.GenerateContentConfig(
                temperature=0.9,
                top_k=40,
                top_p=0.95,
                max_output_tokens=8192,
            ),
        )

        reply_text = response.text

        # Save AI reply into history
        history.append({"role": "model", "parts": [{"text": reply_text}]})
        sessions[session_id] = history

        return jsonify({"response": reply_text, "session_id": session_id})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/reset", methods=["POST"])
def reset_session():
    data = request.get_json(silent=True)
    session_id = data.get("session_id", "default") if data else "default"
    sessions.pop(session_id, None)
    return jsonify({"message": f"Session '{session_id}' cleared."})


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
