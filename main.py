from flask import Flask, request, render_template, jsonify
import time
import cv2
import numpy as np
import paho.mqtt.client as mqtt
import requests
from datetime import datetime
import pytz
import os
import threading
import queue
from roboflow import Roboflow
import supervision as sv

app = Flask(__name__)

# Initialize Roboflow API
rf = Roboflow(api_key="JVIo7YNY8G0Q7BltzRRS")
project = rf.workspace().project("toy-cars-hqi4o")
model = project.version(1).model

# MQTT Configuration
mqtt_broker = "test.mosquitto.org"
mqtt_topic = "esp32/vehicle_count"
attack_topic = "esp32/attack_detection"

client = mqtt.Client(protocol=mqtt.MQTTv311)

# Firebase Configuration
FIREBASE_RTD_URL = "https://iotsecurity-30d1a-default-rtdb.firebaseio.com"
SENSOR_DATA_PATH = f"{FIREBASE_RTD_URL}/sensors"
ATTACK_LOG_PATH = f"{FIREBASE_RTD_URL}/attacks"

message_queue = queue.Queue()
MSG_RATE_THRESHOLD = 50  # Messages per second to flag as DoS
last_message_time = time.time()
message_count = 0
lock = threading.Lock()

# Store for real-time vehicle counts
vehicle_counts = {
    "lane_1": [],
    "lane_2": [],
}  # List of {"timestamp": str, "count": int}


@app.route("/proxy_predict", methods=["POST"])
def proxy_predict():
    data = request.get_json()
    if not data or "lane" not in data or "timestamp" not in data:
        return {"error": "Invalid request data"}, 400

    try:
        response = requests.post(
            "https://robust-embrace-production.up.railway.app/predict",
            json=data,
            headers={"Content-Type": "application/json"},
        )
        response.raise_for_status()
        return response.json(), 200
    except requests.exceptions.RequestException as e:
        print(f"❌ Proxy request failed: {e}")
        return {"error": "Failed to fetch prediction"}, 500


@app.route("/proxy_attack_predict", methods=["POST"])
def proxy_attack_predict():
    data = request.get_json()
    if not data or "timestamp" not in data:
        return {"error": "Invalid request data"}, 400

    try:
        response = requests.post(
            "https://attackpredict-production.up.railway.app/predict",
            json=data,
            headers={"Content-Type": "application/json"},
        )
        response.raise_for_status()
        return response.text, 200
    except requests.exceptions.RequestException as e:
        print(f"❌ Attack proxy request failed: {e}")
        return {"error": "Failed to fetch attack prediction"}, 500


def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print("✅ Connected to MQTT broker")
        client.subscribe(mqtt_topic)
        client.subscribe(attack_topic)
    else:
        print(f"❌ Failed to connect to MQTT broker with code: {rc}")


def on_message(client, userdata, msg):
    global message_count, last_message_time
    current_time = time.time()

    with lock:
        message_count += 1
        elapsed_time = current_time - last_message_time

        if elapsed_time >= 1.0:
            rate = message_count / elapsed_time
            if rate > MSG_RATE_THRESHOLD:
                log_attack(
                    "DoS",
                    f"High message rate detected: {rate:.2f} msg/s",
                    get_ist_time(),
                )
            message_count = 0
            last_message_time = current_time

        try:
            payload = msg.payload.decode("utf-8")
            if not payload:
                log_attack(
                    "Malformed Packet", "Empty MQTT payload received", get_ist_time()
                )
            elif ":" not in payload:
                log_attack(
                    "Malformed Packet",
                    f"Invalid payload format: {payload}",
                    get_ist_time(),
                )
            else:
                message_queue.put((msg.topic, payload))
        except UnicodeDecodeError:
            log_attack("Malformed Packet", "Non-UTF-8 payload received", get_ist_time())


client.on_connect = on_connect
client.on_message = on_message

try:
    client.connect(mqtt_broker, 1883, 60)
    client.loop_start()
except Exception as e:
    print(f"❌ MQTT Connection Failed: {e}")


def log_attack(category, description, timestamp):
    attack_data = {
        "category": category,
        "description": description,
        "timestamp": timestamp,
    }
    unique_key = datetime.now(pytz.timezone("Asia/Kolkata")).strftime(
        "%Y-%m-%d_%H-%M-%S"
    )
    firebase_url = f"{ATTACK_LOG_PATH}/{unique_key}.json"
    try:
        response = requests.put(firebase_url, json=attack_data)
        if response.status_code == 200:
            print(f"✅ Attack logged to Firebase: {attack_data}")
            client.publish(attack_topic, f"{category}: {description}")
        else:
            print(f"❌ Failed to log attack: {response.status_code} - {response.text}")
    except Exception as e:
        print(f"❌ Firebase attack log failed: {e}")


def get_ist_time():
    ist = pytz.timezone("Asia/Kolkata")
    return datetime.now(ist).strftime("%Y-%m-%d %H:%M:%S")


def count_vehicles(image_path):
    if not os.path.exists(image_path) or os.path.getsize(image_path) == 0:
        print(f"❌ Image file {image_path} is missing or empty")
        return 0

    # Run inference with Roboflow model
    try:
        result = model.predict(image_path, confidence=40, overlap=30).json()
    except Exception as e:
        print(f"❌ Roboflow inference failed for {image_path}: {e}")
        return 0

    # Count vehicles from predictions
    if "predictions" not in result or not result["predictions"]:
        print(f"ℹ️ No objects detected in {image_path}")
        return 0

    # Assuming "toy-car" or similar class represents vehicles
    vehicle_count = sum(
        1 for pred in result["predictions"] if pred["class"] == "toy-car"
    )
    print(f"🚗 Detected {vehicle_count} vehicles in {image_path}")
    return vehicle_count


@app.route("/", methods=["GET"])
def dashboard():
    return render_template("dashboard.html")


@app.route("/data_vis", methods=["GET"])
def data_vis():
    return render_template("data_vis.html")


@app.route("/upload", methods=["POST"])
def upload():
    print("📡 Received Upload Request")
    lane_number = request.form.get("lane")
    if not lane_number:
        print("❌ Lane number not provided")
        return {"error": "Lane number not provided"}, 400
    image_file = request.files.get("image")
    if not image_file or image_file.filename == "":
        print("❌ Image not provided or invalid")
        return {"error": "Image not provided"}, 400
    filename = f"capture_{lane_number.replace(' ', '')}{int(time.time())}.jpg"
    try:
        image_file.save(filename)
        print(f"✅ Image saved: {filename}")
    except Exception as e:
        print(f"❌ Failed to save image {filename}: {e}")
        return {"error": "Failed to save image"}, 500
    vehicle_count = count_vehicles(filename)
    print(f"🚗 Vehicle Count for {lane_number}: {vehicle_count}")
    timestamp = get_ist_time()
    data = {"lane": lane_number, "vehicle_count": vehicle_count, "timestamp": timestamp}
    mqtt_payload = f"{lane_number}: {vehicle_count}"
    try:
        client.publish(mqtt_topic, mqtt_payload)
        print(f"✅ Published to MQTT: {mqtt_payload}")
    except Exception as e:
        print(f"❌ Failed to publish to MQTT: {e}")
    firebase_base_url = f"{SENSOR_DATA_PATH}/{lane_number.replace(' ', '_')}"
    unique_key = datetime.now(pytz.timezone("Asia/Kolkata")).strftime(
        "%Y-%m-%d_%H-%M-%S"
    )
    firebase_url = f"{firebase_base_url}/{unique_key}.json"
    try:
        response = requests.put(firebase_url, json=data)
        if response.status_code == 200:
            print(f"✅ Data appended to Firebase: {data}")
    except Exception as e:
        print(f"❌ Firebase request failed: {e}")

    # Store vehicle count for real-time graph
    lane_key = lane_number.replace(" ", "_").lower()
    if lane_key in vehicle_counts:
        vehicle_counts[lane_key].append(
            {"timestamp": timestamp, "count": vehicle_count}
        )
        # Keep only the last 50 entries to avoid memory overload
        vehicle_counts[lane_key] = vehicle_counts[lane_key][-50:]

    return {
        "message": "Image processed",
        "lane": lane_number,
        "vehicle_count": vehicle_count,
        "timestamp": timestamp,
    }, 200


@app.route("/vehicle_counts", methods=["GET", "POST"])
def handle_vehicle_counts():
    global vehicle_counts

    if request.method == "GET":
        return jsonify(vehicle_counts)

    elif request.method == "POST":
        data = request.get_json()
        if (
            not data
            or "lane" not in data
            or "vehicle_count" not in data
            or "timestamp" not in data
        ):
            return jsonify({"error": "Invalid request format"}), 400

        lane = data["lane"].replace(" ", "_").lower()
        vehicle_count = int(data["vehicle_count"])
        timestamp = data["timestamp"]

        if lane not in vehicle_counts:
            return jsonify({"error": "Invalid lane"}), 400

        # Store vehicle count for real-time graph
        vehicle_counts[lane].append({"timestamp": timestamp, "count": vehicle_count})

        # Keep only the last 50 entries to avoid memory overload
        vehicle_counts[lane] = vehicle_counts[lane][-50:]

        return jsonify({"message": "Vehicle count updated"}), 200


@app.route("/predictions")
def predictions():
    return render_template("predictions.html")


@app.route("/sensors")
def sensors():
    return render_template("sensors.html")


@app.route("/model_analytics")
def model_analytics():
    return render_template("model_analytics.html")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
