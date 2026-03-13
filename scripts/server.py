#!/usr/bin/env python3
"""
Flask API server for GNSS file processing.
Accepts RINEX nav + obs file uploads, streams progress via SSE,
and returns satellite data JSON.
In production (when dist/ exists), also serves the built frontend.
"""

import json
import os
import queue
import tempfile
import threading

from flask import Flask, Response, request, jsonify, send_from_directory
from flask_cors import CORS
from process_gnss import process_files

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
APP_ROOT = os.path.dirname(SCRIPT_DIR)
DIST_DIR = os.path.join(APP_ROOT, "dist")

app = Flask(__name__)
CORS(app)


@app.route("/api/process", methods=["POST"])
def process():
    if "nav" not in request.files or "obs" not in request.files:
        return jsonify({"error": "Both 'nav' and 'obs' files are required"}), 400

    nav_file = request.files["nav"]
    obs_file = request.files["obs"]

    tmpdir = tempfile.mkdtemp()
    nav_path = os.path.join(tmpdir, nav_file.filename)
    obs_path = os.path.join(tmpdir, obs_file.filename)
    nav_file.save(nav_path)
    obs_file.save(obs_path)

    progress_queue = queue.Queue()

    def on_progress(message, percent=None):
        progress_queue.put(("progress", message, percent))

    def run_processing():
        try:
            result = process_files(nav_path, obs_path, on_progress)
            progress_queue.put(("done", result, None))
        except Exception as e:
            progress_queue.put(("error", str(e), None))
        finally:
            import shutil
            shutil.rmtree(tmpdir, ignore_errors=True)

    thread = threading.Thread(target=run_processing)
    thread.start()

    def generate():
        while True:
            try:
                event_type, data, percent = progress_queue.get(timeout=300)
            except queue.Empty:
                yield "event: error\ndata: {\"error\": \"Processing timed out\"}\n\n"
                break

            if event_type == "progress":
                payload = {"message": data}
                if percent is not None:
                    payload["percent"] = percent
                yield f"event: progress\ndata: {json.dumps(payload)}\n\n"
            elif event_type == "done":
                yield f"event: result\ndata: {json.dumps(data)}\n\n"
                break
            elif event_type == "error":
                yield f"event: error\ndata: {json.dumps({'error': data})}\n\n"
                break

    return Response(generate(), mimetype="text/event-stream")


if os.path.isdir(DIST_DIR):
    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve_spa(path):
        if path and os.path.exists(os.path.join(DIST_DIR, path)):
            return send_from_directory(DIST_DIR, path)
        return send_from_directory(DIST_DIR, "index.html")


if __name__ == "__main__":
    app.run(port=5001, debug=True)
