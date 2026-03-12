#!/usr/bin/env python3
"""
Flask API server for GNSS file processing.
Accepts RINEX nav + obs file uploads and returns satellite data JSON.
"""

import os
import tempfile
from flask import Flask, request, jsonify
from flask_cors import CORS
from process_gnss import process_files

app = Flask(__name__)
CORS(app)


@app.route("/api/process", methods=["POST"])
def process():
    if "nav" not in request.files or "obs" not in request.files:
        return jsonify({"error": "Both 'nav' and 'obs' files are required"}), 400

    nav_file = request.files["nav"]
    obs_file = request.files["obs"]

    with tempfile.TemporaryDirectory() as tmpdir:
        nav_path = os.path.join(tmpdir, nav_file.filename)
        obs_path = os.path.join(tmpdir, obs_file.filename)

        nav_file.save(nav_path)
        obs_file.save(obs_path)

        try:
            result = process_files(nav_path, obs_path)
            return jsonify(result)
        except Exception as e:
            return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(port=5001, debug=True)
