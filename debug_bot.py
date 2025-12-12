
import sys
import os
import json
import time
from datetime import datetime

# Add project root to path
sys.path.append(os.path.abspath(os.path.dirname(__file__)))

from infra.database import Database
from core.engine.trading_engine import TradingEngine
from core.market.market_data_service import MarketDataService
from core.strategy.arbitrage_strategy import ArbitrageStrategy

def run_debug():
    print("="*50)
    print("DEBUG DIAGNOSTIC TOOL")
    print("="*50)
    
    # 1. Check Database
    db_path = 'AITradeGame.db'
    if not os.path.exists(db_path):
        print(f"[ERROR] Database file not found at {db_path}")
        return
    
    print(f"[INFO] Database found at {db_path}")
    db = Database(db_path)
    
    # 2. Check Models
    models = db.get_all_models()
    print(f"[INFO] Found {len(models)} models:")
    for m in models:
        print(f"  - ID: {m['id']}, Name: {m['name']}, Strategy: {m.get('strategy_type')}")
        
    if not models:
        print("[WARN] No models found. Please create a model in the UI first.")
        return

    # 3. Test Logging
    test_model_id = models[0]['id']
    print(f"\n[TEST] Attempting to write log to Model {test_model_id}...")
    try:
        db.add_conversation(
            test_model_id,
            user_prompt="Debug Script Test",
            ai_response=json.dumps({"message": "This is a test log from debug script"}, ensure_ascii=False)
        )
        print("[PASS] Log written successfully")
    except Exception as e:
        print(f"[FAIL] Failed to write log: {e}")
        return

    # 4. Test Reading Logs
    print(f"\n[TEST] Reading logs for Model {test_model_id}...")
    logs = db.get_conversations(test_model_id, limit=5)
    if logs:
        print(f"[PASS] Found {len(logs)} logs. Most recent:")
        print(f"  Time: {logs[0]['timestamp']}")
        print(f"  Content: {logs[0]['ai_response']}")
    else:
        print("[FAIL] No logs found (even though we just wrote one!)")

    # 5. Test Trading Engine Execution
    print(f"\n[TEST] Initializing Trading Engine for Model {test_model_id}...")
    try:
        market_service = MarketDataService()
        # Create a dummy strategy for testing
        strategy = ArbitrageStrategy(
            model_id=test_model_id,
            market_service=market_service,
            config={'min_net_spread_pct': -5.0}
        )
        
        engine = TradingEngine(
            model_id=test_model_id,
            db=db,
            market_service=market_service,
            strategy=strategy
        )
        
        print("[INFO] Executing one trading cycle...")
        result = engine.execute_trading_cycle()
        
        if result['success']:
            print("[PASS] Trading cycle executed successfully")
            print(f"  Signals: {len(result.get('signals', []))}")
            print(f"  Executions: {len(result.get('executions', []))}")
        else:
            print(f"[FAIL] Trading cycle failed: {result.get('error')}")
            
    except Exception as e:
        print(f"[FAIL] Engine crash: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    run_debug()
