#!/usr/bin/env python3
"""
News Intelligence System - Web UI
Flask-based web interface for multi-AI article scoring.

Run: python web_app.py
Then open http://localhost:5000
"""

import json
import os
import queue
import threading
import time

from flask import Flask, Response, jsonify, render_template, request

# Reuse data from demo.py
from demo import AI_MODELS, SAMPLE_ARTICLES, SIMULATED_SCORES

app = Flask(__name__)

# Global queue for SSE events per analysis session
analysis_events = {}


def _send_event(session_id, event_type, data):
    """Push an SSE event to the session queue."""
    if session_id in analysis_events:
        analysis_events[session_id].put({"event": event_type, "data": data})


def run_demo_analysis(session_id, article_index):
    """Run a simulated analysis pipeline with progress events."""
    article = SAMPLE_ARTICLES[article_index]
    _send_event(session_id, "step", {"step": "health_check", "message": "Checking AI engines..."})

    # Step 0: Health check
    for model, config in AI_MODELS.items():
        time.sleep(0.3)
        _send_event(
            session_id,
            "health",
            {
                "model": model,
                "status": "online",
                "latency": 42 + hash(model) % 50,
            },
        )
    _send_event(
        session_id, "step", {"step": "health_check_done", "message": "All 5 AI engines operational"}
    )
    time.sleep(0.3)

    # Step 1: Individual scoring
    _send_event(session_id, "step", {"step": "scoring", "message": "AI models scoring article..."})
    for model, data in SIMULATED_SCORES.items():
        time.sleep(0.5)
        _send_event(
            session_id,
            "score",
            {
                "model": model,
                "score": data["score"],
                "reasoning": data["reasoning"],
                "strengths": data["strengths"],
                "concerns": data["concerns"],
            },
        )
    time.sleep(0.3)

    # Step 2: Peer review
    _send_event(
        session_id, "step", {"step": "peer_review", "message": "Peer review in progress..."}
    )
    pairs = [
        ("ChatGPT", "Perplexity", "AGREEMENT"),
        ("Claude", "Grok", "AGREEMENT"),
        ("Gemini", "Claude", "DISAGREEMENT"),
    ]
    for ai1, ai2, result in pairs:
        time.sleep(0.4)
        _send_event(
            session_id,
            "peer",
            {
                "ai1": ai1,
                "ai2": ai2,
                "score1": SIMULATED_SCORES[ai1]["score"],
                "score2": SIMULATED_SCORES[ai2]["score"],
                "result": result,
            },
        )
    time.sleep(0.3)

    # Step 3: Fact check
    _send_event(
        session_id, "step", {"step": "fact_check", "message": "Perplexity fact-checking claims..."}
    )
    time.sleep(0.5)
    fact_checks = [
        {
            "claim": "15-20% improvement on reasoning tests",
            "verdict": "VERIFIED",
            "details": "Matches published benchmarks",
        },
        {
            "claim": "Human-level reasoning",
            "verdict": "PARTIAL",
            "details": "True for narrow tasks, contested for general",
        },
    ]
    _send_event(session_id, "facts", {"checks": fact_checks})
    time.sleep(0.3)

    # Step 4: Consensus
    _send_event(
        session_id, "step", {"step": "consensus", "message": "Calculating consensus score..."}
    )
    time.sleep(0.5)
    scores = [d["score"] for d in SIMULATED_SCORES.values()]
    avg_score = sum(scores) / len(scores)
    _send_event(
        session_id,
        "consensus",
        {
            "score": round(avg_score, 1),
            "confidence": "HIGH",
            "variance": 0.8,
            "recommendation": "SHARE WITH CONTEXT",
        },
    )
    time.sleep(0.3)

    # Step 5: Insights
    _send_event(session_id, "step", {"step": "insights", "message": "Generating insights..."})
    time.sleep(0.3)
    insights = [
        {
            "category": "FACTUAL ACCURACY",
            "rating": "High",
            "details": "Claims verified against published sources",
        },
        {
            "category": "SOURCE QUALITY",
            "rating": "Excellent",
            "details": f"{article['source']} is Tier-1 publication",
        },
        {
            "category": "HEADLINE CONCERN",
            "rating": "Moderate",
            "details": "'Human-level' framing debated",
        },
        {
            "category": "RECOMMENDATION",
            "rating": "Share with context",
            "details": "Good for professional network",
        },
    ]
    _send_event(session_id, "insights", {"insights": insights})

    # Done
    _send_event(session_id, "step", {"step": "done", "message": "Analysis complete"})
    _send_event(session_id, "done", {})


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/articles")
def get_articles():
    return jsonify(SAMPLE_ARTICLES)


@app.route("/api/analyze", methods=["POST"])
def start_analysis():
    data = request.get_json()
    article_index = data.get("article_index", 0)
    session_id = f"session_{int(time.time() * 1000)}"
    analysis_events[session_id] = queue.Queue()

    thread = threading.Thread(
        target=run_demo_analysis, args=(session_id, article_index), daemon=True
    )
    thread.start()

    return jsonify({"session_id": session_id})


@app.route("/api/analyze/stream")
def stream_analysis():
    session_id = request.args.get("session_id")
    if not session_id or session_id not in analysis_events:
        return Response("Invalid session", status=400)

    def generate():
        q = analysis_events[session_id]
        while True:
            try:
                event = q.get(timeout=30)
                yield f"event: {event['event']}\ndata: {json.dumps(event['data'])}\n\n"
                if event["event"] == "done":
                    break
            except queue.Empty:
                yield "event: ping\ndata: {}\n\n"
        # Cleanup
        analysis_events.pop(session_id, None)

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.route("/api/sample-report")
def sample_report():
    report_path = os.path.join(os.path.dirname(__file__), "sample_output", "analysis_report.json")
    with open(report_path) as f:
        return jsonify(json.load(f))


if __name__ == "__main__":
    app.run(debug=os.environ.get("FLASK_DEBUG", "0") == "1", host="0.0.0.0", port=5000)
