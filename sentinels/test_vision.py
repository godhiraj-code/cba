import httpx
import base64
import json
import os

def test_vision():
    screenshot_path = r'c:\cba\screenshots\1767010417603_BEFORE_click.png'
    if not os.path.exists(screenshot_path):
        print(f"Screenshot not found at {screenshot_path}")
        return

    with open(screenshot_path, "rb") as image_file:
        screenshot_b64 = base64.b64encode(image_file.read()).decode('utf-8')

    url = "http://localhost:11434/api/generate"
    payload = {
        "model": "moondream",
        "prompt": "What is the main obstacle in this image? Describe it in one sentence.",
        "images": [screenshot_b64],
        "stream": False
    }

    print("Sending request to Ollama (this may take a while on CPU)...")
    try:
        with httpx.Client(timeout=120.0) as client:
            response = client.post(url, json=payload)
            if response.status_code == 200:
                print("--- AI RESPONSE ---")
                print(response.json().get("response"))
                print("-------------------")
            else:
                print(f"Error: {response.status_code}")
                print(response.text)
    except Exception as e:
        print(f"Exception: {e}")

if __name__ == "__main__":
    test_vision()
