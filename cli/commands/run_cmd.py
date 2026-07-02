"""
Starlight CLI - Run Command
Launches the full CBA constellation (Hub + Sentinels).
"""

import os
import sys
import subprocess
import signal
import socket
import time
import json
import urllib.request
import urllib.error
from threading import Event


_poll_waiter = Event()


def is_port_in_use(port: int) -> bool:
    """Check if a port is already in use."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('localhost', port)) == 0


def kill_process_on_port(port: int):
    """Kill any process using the specified port (Windows-specific)."""
    if sys.platform == "win32":
        try:
            result = subprocess.run(
                ['netstat', '-aon'],
                capture_output=True, text=True
            )
            for line in result.stdout.strip().split('\n'):
                if f':{port}' in line:
                    parts = line.split()
                    if len(parts) >= 5:
                        pid = parts[-1]
                        if pid.isdigit():
                            # Security: Use argument list, not shell string
                            subprocess.run(['taskkill', '/f', '/pid', pid], capture_output=True)
                            print(f"  [*] Killed process {pid} on port {port}")
        except Exception as e:
            print(f"  [!] Could not kill process on port {port}: {e}")
    else:
        # Unix-like systems
        try:
            subprocess.run(f'lsof -ti:{port} | xargs kill -9', shell=True, capture_output=True)
        except Exception:
            pass


def wait_until(label: str, predicate, timeout: float = 30.0, interval: float = 0.25):
    """Poll an observable condition until it is true or the deadline expires."""
    deadline = time.monotonic() + timeout
    last_error = None

    while time.monotonic() < deadline:
        try:
            result = predicate()
            if result:
                return result
        except Exception as error:
            last_error = error
        _poll_waiter.wait(min(interval, max(0.0, deadline - time.monotonic())))

    detail = f": {last_error}" if last_error else ""
    raise TimeoutError(f"Timed out waiting for {label}{detail}")


def read_hub_health(port: int = 8080):
    """Read Hub health without relying on a fixed startup delay."""
    with urllib.request.urlopen(f"http://localhost:{port}/health", timeout=1) as response:
        return json.loads(response.read().decode("utf-8"))


def wait_for_hub(port: int = 8080, timeout: float = 30.0):
    return wait_until(
        "Hub health",
        lambda: (health if (health := read_hub_health(port)).get("status") == "healthy" else None),
        timeout=timeout
    )


def wait_for_sentinel_registration(expected_count: int, port: int = 8080, timeout: float = 30.0):
    if expected_count <= 0:
        return None

    def enough_registered():
        health = read_hub_health(port)
        sentinels = health.get("sentinels") or []
        return health if len(sentinels) >= expected_count else None

    return wait_until(
        f"{expected_count} Sentinel registrations",
        enough_registered,
        timeout=timeout
    )


def discover_sentinels(sentinels_dir: str) -> list:
    """Find all Python sentinel files in the sentinels directory."""
    sentinels = []
    if os.path.exists(sentinels_dir):
        for filename in os.listdir(sentinels_dir):
            if filename.endswith('.py') and not filename.startswith('__') and not filename.startswith('test'):
                sentinels.append(os.path.join(sentinels_dir, filename))
    return sentinels


def execute(intent: str = None, no_sentinels: bool = False):
    """Launch the CBA constellation."""
    print("[Starlight] Launching Constellation...")
    
    # Check for required files
    hub_path = os.path.join(os.getcwd(), "src", "hub.js")
    if not os.path.exists(hub_path):
        print("[Starlight] ERROR: src/hub.js not found. Are you in a CBA project directory?")
        return False
    
    # Clean up port 8080
    if is_port_in_use(8080):
        print("  [*] Port 8080 in use, cleaning up...")
        kill_process_on_port(8080)
        wait_until("port 8080 to be released", lambda: not is_port_in_use(8080), timeout=5, interval=0.1)
    
    processes = []
    
    try:
        # 1. Launch Hub
        print("  [+] Starting Hub (node src/hub.js)...")
        if sys.platform == "win32":
            hub_process = subprocess.Popen(
                ["node", "src/hub.js"],
                creationflags=subprocess.CREATE_NEW_CONSOLE
            )
        else:
            hub_process = subprocess.Popen(
                ["node", "src/hub.js"],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE
            )
        processes.append(("Hub", hub_process))
        wait_for_hub(8080, timeout=30)
        print("  [✓] Hub is healthy.")
        
        # 2. Launch Sentinels (unless --no-sentinels)
        if not no_sentinels:
            sentinels_dir = os.path.join(os.getcwd(), "sentinels")
            sentinel_files = discover_sentinels(sentinels_dir)
            sentinel_env = os.environ.copy()
            sentinel_env["HUB_URL"] = "ws://localhost:8080"
            
            for sentinel_path in sentinel_files:
                sentinel_name = os.path.basename(sentinel_path)
                print(f"  [+] Starting Sentinel: {sentinel_name}...")
                
                if sys.platform == "win32":
                    sentinel_process = subprocess.Popen(
                        ["python", sentinel_path],
                        env=sentinel_env,
                        creationflags=subprocess.CREATE_NEW_CONSOLE
                    )
                else:
                    sentinel_process = subprocess.Popen(
                        ["python", sentinel_path],
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                        env=sentinel_env
                    )
                processes.append((sentinel_name, sentinel_process))
            wait_for_sentinel_registration(len(sentinel_files), port=8080, timeout=30)
            print(f"  [✓] Registered {len(sentinel_files)} Sentinel(s).")
        
        # 3. Run Intent (if provided)
        if intent:
            intent_path = intent if os.path.isabs(intent) else os.path.join(os.getcwd(), intent)
            if not os.path.exists(intent_path):
                print(f"[Starlight] ERROR: Intent script not found: {intent}")
            else:
                print(f"  [+] Executing Intent: {intent}...")
                result = subprocess.run(["node", intent_path])
                if result.returncode != 0:
                    print(f"[Starlight] ERROR: Intent exited with code {result.returncode}")
                    return False
        
        # If no intent, keep constellation running
        if not intent:
            print("\n[Starlight] Constellation is running. Press Ctrl+C to stop.")
            try:
                while True:
                    try:
                        hub_process.wait(timeout=1)
                        print("[Starlight] Hub has stopped.")
                        break
                    except subprocess.TimeoutExpired:
                        pass
            except KeyboardInterrupt:
                print("\n[Starlight] Shutting down constellation...")
        
    except Exception as e:
        print(f"[Starlight] ERROR: {e}")
    finally:
        # Cleanup: terminate all processes
        for name, proc in processes:
            if proc.poll() is None:
                proc.terminate()
                print(f"  [-] Stopped: {name}")
    
    print("[Starlight] Constellation stopped.")
    return True
