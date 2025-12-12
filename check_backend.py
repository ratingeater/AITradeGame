import requests
import sys
import time

def check_backend():
    print("Checking backend status on http://localhost:5001...")
    try:
        response = requests.get("http://localhost:5001/api/health", timeout=2)
        if response.status_code == 200:
            print("✅ Backend is ONLINE!")
            print(f"Version: {response.json().get('version')}")
            return True
        else:
            print(f"❌ Backend returned status code: {response.status_code}")
            return False
    except requests.exceptions.ConnectionError:
        print("❌ Connection Refused. The backend is NOT running.")
        print("   Please run: python3 web/app.py")
        return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

if __name__ == "__main__":
    check_backend()
