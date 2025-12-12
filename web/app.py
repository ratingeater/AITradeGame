import sys
import os

# Add project root to sys.path to allow importing core and infra modules
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
import time
import threading
import json
import re
from datetime import datetime
from core.engine.trading_engine import TradingEngine
from core.market.market_data_service import MarketDataService
from core.llm.ai_trader import AITrader
from infra.database import Database
from core.strategy.llm_json_strategy import LLMJsonStrategy
from core.strategy.arbitrage_strategy import ArbitrageStrategy
from version import __version__, __github_owner__, __repo__, GITHUB_REPO_URL, LATEST_RELEASE_URL

app = Flask(__name__)
CORS(app)

db = Database(os.path.join(os.path.dirname(os.path.dirname(__file__)), 'AITradeGame.db'))
market_service = MarketDataService()
trading_engines = {}
auto_trading = False
TRADE_FEE_RATE = 0.001  # 默认交易费率

@app.route('/')
def index():
    return render_template('index.html')

# ============ Provider API Endpoints ============

@app.route('/api/providers', methods=['GET'])
def get_providers():
    """Get all API providers"""
    providers = db.get_all_providers()
    return jsonify(providers)

@app.route('/api/providers', methods=['POST'])
def add_provider():
    """Add new API provider"""
    data = request.json
    try:
        provider_id = db.add_provider(
            name=data['name'],
            api_url=data['api_url'],
            api_key=data['api_key'],
            models=data.get('models', '')
        )
        return jsonify({'id': provider_id, 'message': 'Provider added successfully'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/providers/<int:provider_id>', methods=['DELETE'])
def delete_provider(provider_id):
    """Delete API provider"""
    try:
        db.delete_provider(provider_id)
        return jsonify({'message': 'Provider deleted successfully'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/providers/models', methods=['POST'])
def fetch_provider_models():
    """Fetch available models from provider's API"""
    data = request.json
    api_url = data.get('api_url')
    api_key = data.get('api_key')

    if not api_url or not api_key:
        return jsonify({'error': 'API URL and key are required'}), 400

    try:
        # This is a placeholder - implement actual API call based on provider
        # For now, return empty list or common models
        models = []

        # Try to detect provider type and call appropriate API
        if 'openai.com' in api_url.lower():
            # OpenAI API call
            import requests
            headers = {
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json'
            }
            response = requests.get(f'{api_url}/models', headers=headers, timeout=10)
            if response.status_code == 200:
                result = response.json()
                models = [m['id'] for m in result.get('data', []) if 'gpt' in m['id'].lower()]
        elif 'deepseek' in api_url.lower():
            # DeepSeek API
            import requests
            headers = {
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json'
            }
            response = requests.get(f'{api_url}/models', headers=headers, timeout=10)
            if response.status_code == 200:
                result = response.json()
                models = [m['id'] for m in result.get('data', [])]
        else:
            # Default: return common model names
            models = ['gpt-3.5-turbo', 'gpt-4', 'gpt-4-turbo']

        return jsonify({'models': models})
    except Exception as e:
        print(f"[ERROR] Fetch models failed: {e}")
        return jsonify({'error': f'Failed to fetch models: {str(e)}'}), 500

# ============ Model API Endpoints ============

@app.route('/api/models', methods=['GET'])
def get_models():
    models = db.get_all_models()
    return jsonify(models)

@app.route('/api/models', methods=['POST'])
def add_model():
    data = request.json
    try:
        strategy_type = data.get('strategy_type', 'llm_json')
        provider_id = data.get('provider_id')
        
        # Validate provider only if needed
        if strategy_type == 'llm_json':
            if not provider_id:
                return jsonify({'error': 'Provider is required for AI Trader'}), 400
            
            # Convert to int if it's a string
            try:
                provider_id = int(provider_id)
            except (ValueError, TypeError):
                return jsonify({'error': 'Invalid provider ID'}), 400

            provider = db.get_provider(provider_id)
            if not provider:
                return jsonify({'error': 'Provider not found'}), 404
        
        # Ensure provider_id is None if empty (for Arbitrage)
        if not provider_id:
            provider_id = None
        else:
            try:
                provider_id = int(provider_id)
            except:
                provider_id = None

        model_id = db.add_model(
            name=data['name'],
            provider_id=provider_id,
            model_name=data.get('model_name', ''),
            initial_capital=float(data.get('initial_capital', 100000)),
            strategy_type=strategy_type
        )

        model = db.get_model(model_id)
        
        # Initialize Strategy
        if strategy_type == 'arbitrage':
            strategy = ArbitrageStrategy(
                model_id=model_id,
                market_service=market_service,
                config={'min_net_spread_pct': 0.01}
            )
        else:
            # Default to LLM Strategy
            # We already validated provider exists above
            provider = db.get_provider(provider_id)
            ai_trader = AITrader(
                provider_type=provider.get('provider_type', 'openai'),
                api_key=provider['api_key'],
                api_url=provider['api_url'],
                model_name=model['model_name']
            )
            strategy = LLMJsonStrategy(
                model_id=model_id,
                trader=ai_trader,
                config={}
            )

        trading_engines[model_id] = TradingEngine(
            model_id=model_id,
            db=db,
            market_service=market_service,
            strategy=strategy,
            trade_fee_rate=TRADE_FEE_RATE
        )
        print(f"[INFO] Model {model_id} ({data['name']}) initialized with {strategy_type} strategy")

        return jsonify({'id': model_id, 'message': 'Model added successfully'})

    except Exception as e:
        print(f"[ERROR] Failed to add model: {e}")
        import traceback
        print(traceback.format_exc())
        return jsonify({'error': str(e)}), 500

@app.route('/api/models/<int:model_id>', methods=['DELETE'])
def delete_model(model_id):
    try:
        model = db.get_model(model_id)
        model_name = model['name'] if model else f"ID-{model_id}"
        
        db.delete_model(model_id)
        if model_id in trading_engines:
            del trading_engines[model_id]
        
        print(f"[INFO] Model {model_id} ({model_name}) deleted")
        return jsonify({'message': 'Model deleted successfully'})
    except Exception as e:
        print(f"[ERROR] Delete model {model_id} failed: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/models/<int:model_id>/portfolio', methods=['GET'])
def get_portfolio(model_id):
    prices_data = market_service.get_current_prices(['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE'])
    current_prices = {coin: prices_data[coin]['price'] for coin in prices_data}
    
    portfolio = db.get_portfolio(model_id, current_prices)
    account_value = db.get_account_value_history(model_id, limit=100)
    
    return jsonify({
        'portfolio': portfolio,
        'account_value_history': account_value
    })

@app.route('/api/models/<int:model_id>/trades', methods=['GET'])
def get_trades(model_id):
    limit = request.args.get('limit', 50, type=int)
    trades = db.get_trades(model_id, limit=limit)
    return jsonify(trades)

@app.route('/api/models/<int:model_id>/conversations', methods=['GET'])
def get_conversations(model_id):
    limit = request.args.get('limit', 20, type=int)
    print(f"[DEBUG] API: Fetching conversations for model {model_id}, limit={limit}", flush=True)
    conversations = db.get_conversations(model_id, limit=limit)
    print(f"[DEBUG] API: Found {len(conversations)} conversations", flush=True)
    return jsonify(conversations)

@app.route('/api/aggregated/portfolio', methods=['GET'])
def get_aggregated_portfolio():
    """Get aggregated portfolio data across all models"""
    prices_data = market_service.get_current_prices(['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE'])
    current_prices = {coin: prices_data[coin]['price'] for coin in prices_data}

    # Get aggregated data
    models = db.get_all_models()
    total_portfolio = {
        'total_value': 0,
        'cash': 0,
        'positions_value': 0,
        'realized_pnl': 0,
        'unrealized_pnl': 0,
        'initial_capital': 0,
        'positions': []
    }

    all_positions = {}

    for model in models:
        portfolio = db.get_portfolio(model['id'], current_prices)
        if portfolio:
            total_portfolio['total_value'] += portfolio.get('total_value', 0)
            total_portfolio['cash'] += portfolio.get('cash', 0)
            total_portfolio['positions_value'] += portfolio.get('positions_value', 0)
            total_portfolio['realized_pnl'] += portfolio.get('realized_pnl', 0)
            total_portfolio['unrealized_pnl'] += portfolio.get('unrealized_pnl', 0)
            total_portfolio['initial_capital'] += portfolio.get('initial_capital', 0)

            # Aggregate positions by coin and side
            for pos in portfolio.get('positions', []):
                key = f"{pos['coin']}_{pos['side']}"
                if key not in all_positions:
                    all_positions[key] = {
                        'coin': pos['coin'],
                        'side': pos['side'],
                        'quantity': 0,
                        'avg_price': 0,
                        'total_cost': 0,
                        'leverage': pos['leverage'],
                        'current_price': pos['current_price'],
                        'pnl': 0
                    }

                # Weighted average calculation
                current_pos = all_positions[key]
                current_cost = current_pos['quantity'] * current_pos['avg_price']
                new_cost = pos['quantity'] * pos['avg_price']
                total_quantity = current_pos['quantity'] + pos['quantity']

                if total_quantity > 0:
                    current_pos['avg_price'] = (current_cost + new_cost) / total_quantity
                    current_pos['quantity'] = total_quantity
                    current_pos['total_cost'] = current_cost + new_cost
                    current_pos['pnl'] = (pos['current_price'] - current_pos['avg_price']) * total_quantity

    total_portfolio['positions'] = list(all_positions.values())

    # Get multi-model chart data
    chart_data = db.get_multi_model_chart_data(limit=100)

    return jsonify({
        'portfolio': total_portfolio,
        'chart_data': chart_data,
        'model_count': len(models)
    })

@app.route('/api/models/chart-data', methods=['GET'])
def get_models_chart_data():
    """Get chart data for all models"""
    limit = request.args.get('limit', 100, type=int)
    chart_data = db.get_multi_model_chart_data(limit=limit)
    return jsonify(chart_data)

@app.route('/api/market/prices', methods=['GET'])
def get_market_prices():
    coins = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE']
    prices = market_service.get_current_prices(coins)
    return jsonify(prices)

@app.route('/api/control/start', methods=['POST'])
def start_auto_trading():
    global auto_trading
    if not auto_trading:
        auto_trading = True
        # Start trading thread
        thread = threading.Thread(target=trading_loop, daemon=True)
        thread.start()
        print("[INFO] Auto-trading started via API")
    return jsonify({'status': 'started', 'auto_trading': True})

@app.route('/api/control/stop', methods=['POST'])
def stop_auto_trading():
    global auto_trading
    if auto_trading:
        auto_trading = False
        print("[INFO] Auto-trading stopped via API")
    return jsonify({'status': 'stopped', 'auto_trading': False})

@app.route('/api/status', methods=['GET'])
def get_system_status():
    """Get system status including trading loop status"""
    active_models = db.get_active_models()
    return jsonify({
        'status': 'running',
        'timestamp': datetime.now().isoformat(),
        'auto_trading': auto_trading,
        'active_engines': list(trading_engines.keys()),
        'active_models_count': len(active_models),
        'trading_engines_count': len(trading_engines),
        'version': __version__
    })

@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok', 'version': __version__})

@app.errorhandler(404)
def page_not_found(e):
    print(f"[404] Not Found: {request.url}", flush=True)
    return jsonify(error="Resource not found", path=request.path), 404

@app.route('/api/models/<int:model_id>/execute', methods=['POST'])
def execute_trading(model_id):
    if model_id not in trading_engines:
        model = db.get_model(model_id)
        if not model:
            return jsonify({'error': 'Model not found'}), 404

        strategy_type = model.get('strategy_type', 'llm_json')
        
        # Initialize Strategy
        if strategy_type == 'arbitrage':
            strategy = ArbitrageStrategy(
                model_id=model_id,
                market_service=market_service,
                config={'min_net_spread_pct': 0.01}
            )
        else:
            # Get provider info
            if not model['provider_id']:
                 return jsonify({'error': 'Provider ID missing for LLM strategy'}), 400
                 
            provider = db.get_provider(model['provider_id'])
            if not provider:
                return jsonify({'error': 'Provider not found'}), 404

            ai_trader = AITrader(
                provider_type=provider.get('provider_type', 'openai'),
                api_key=provider['api_key'],
                api_url=provider['api_url'],
                model_name=model['model_name']
            )
            strategy = LLMJsonStrategy(
                model_id=model_id,
                trader=ai_trader,
                config={}
            )

        trading_engines[model_id] = TradingEngine(
            model_id=model_id,
            db=db,
            market_service=market_service,
            strategy=strategy,
            trade_fee_rate=TRADE_FEE_RATE
        )
    
    try:
        result = trading_engines[model_id].execute_trading_cycle()
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def trading_loop():
    # Setup file logging
    log_file = open('backend.log', 'a')
    def log(msg):
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        print(f"[{timestamp}] {msg}", flush=True)
        log_file.write(f"[{timestamp}] {msg}\n")
        log_file.flush()

    log("[INFO] Trading loop started")
    
    # Log startup to DB for the first available model to confirm loop start
    try:
        models = db.get_all_models()
        if models:
            db.add_conversation(
                models[0]['id'],
                user_prompt="System Startup",
                ai_response=json.dumps({
                    "message": f"Trading Loop Started. Time: {datetime.now().strftime('%H:%M:%S')}",
                    "version": __version__
                }, ensure_ascii=False)
            )
    except Exception as e:
        log(f"[WARN] Failed to log startup: {e}")

    while auto_trading:
        try:
            # Refresh active models from DB
            active_models = db.get_active_models()
            log(f"[DEBUG] Loop iteration. Active models: {len(active_models)}, Engines: {len(trading_engines)}")
            
            # FORCE LOG: Write a heartbeat to DB for all active models to prove loop is running
            for model in active_models:
                try:
                    db.add_conversation(
                        model['id'],
                        user_prompt="System Debug",
                        ai_response=json.dumps({
                            "message": f"Trading Loop Active. Time: {datetime.now().strftime('%H:%M:%S')}",
                            "engine_status": "Running" if model['id'] in trading_engines else "Initializing"
                        }, ensure_ascii=False)
                    )
                except Exception as e:
                    log(f"[ERROR] Failed to write debug log for model {model['id']}: {e}")

            # Initialize engines for active models
            for model in active_models:
                model_id = model['id']
                if model_id not in trading_engines:
                    log(f"[INFO] Initializing engine for Model {model_id} ({model['strategy_type']})")
                    
                    strategy_type = model.get('strategy_type', 'llm_json')
                    
                    # Initialize Strategy
                    if strategy_type == 'arbitrage':
                        strategy = ArbitrageStrategy(
                            model_id=model_id,
                            market_service=market_service,
                            config={'min_net_spread_pct': -5.0} # Debug: Force trades
                        )
                    else:
                        # Get provider info
                        if not model['provider_id']:
                            log(f"[WARN] Model {model_id} missing provider_id")
                            continue
                            
                        provider = db.get_provider(model['provider_id'])
                        if not provider:
                            log(f"[WARN] Model {model_id} provider not found")
                            continue

                        ai_trader = AITrader(
                            provider_type=provider.get('provider_type', 'openai'),
                            api_key=provider['api_key'],
                            api_url=provider['api_url'],
                            model_name=model['model_name']
                        )
                        strategy = LLMJsonStrategy(
                            model_id=model_id,
                            trader=ai_trader,
                            config={}
                        )

                    trading_engines[model_id] = TradingEngine(
                        model_id=model_id,
                        db=db,
                        market_service=market_service,
                        strategy=strategy,
                        trade_fee_rate=TRADE_FEE_RATE
                    )

            if not trading_engines:
                log("[INFO] No active trading engines. Waiting...")
                time.sleep(10)
                continue
            
            log(f"[CYCLE] Active models: {len(trading_engines)}")
            
            for model_id, engine in list(trading_engines.items()):
                try:
                    log(f"[EXEC] Model {model_id}")
                    result = engine.execute_trading_cycle()
                    
                    if result.get('success'):
                        log(f"[OK] Model {model_id} completed")
                        if result.get('executions'):
                            for exec_result in result['executions']:
                                signal = exec_result.get('signal', 'unknown')
                                coin = exec_result.get('coin', 'unknown')
                                msg = exec_result.get('message', '')
                                if signal != 'hold':
                                    log(f"  [TRADE] {coin}: {msg}")
                    else:
                        error = result.get('error', 'Unknown error')
                        log(f"[WARN] Model {model_id} failed: {error}")
                        
                except Exception as e:
                    log(f"[ERROR] Model {model_id} exception: {e}")
                    import traceback
                    log(traceback.format_exc())
                    continue
            
            # Get sleep time from settings
            settings = db.get_settings()
            sleep_minutes = settings.get('trading_frequency_minutes', 1)
            # Cap at 60 seconds for simulation responsiveness, regardless of DB setting
            sleep_seconds = max(10, min(sleep_minutes * 60, 60))

            log(f"[SLEEP] Waiting {sleep_seconds} seconds for next cycle")
            
            time.sleep(sleep_seconds)
            
        except Exception as e:
            log(f"[CRITICAL] Trading loop error: {e}")
            import traceback
            log(traceback.format_exc())
            log("[RETRY] Retrying in 60 seconds")
            time.sleep(60)
    
    print("[INFO] Trading loop stopped")

@app.route('/api/leaderboard', methods=['GET'])
def get_leaderboard():
    models = db.get_all_models()
    leaderboard = []
    
    prices_data = market_service.get_current_prices(['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE'])
    current_prices = {coin: prices_data[coin]['price'] for coin in prices_data}
    
    for model in models:
        portfolio = db.get_portfolio(model['id'], current_prices)
        account_value = portfolio.get('total_value', model['initial_capital'])
        returns = ((account_value - model['initial_capital']) / model['initial_capital']) * 100
        
        leaderboard.append({
            'model_id': model['id'],
            'model_name': model['name'],
            'strategy_type': model.get('strategy_type', 'llm_json'),
            'account_value': account_value,
            'returns': returns,
            'initial_capital': model['initial_capital']
        })
    
    leaderboard.sort(key=lambda x: x['returns'], reverse=True)
    return jsonify(leaderboard)

@app.route('/api/settings', methods=['GET'])
def get_settings():
    """Get system settings"""
    try:
        settings = db.get_settings()
        return jsonify(settings)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/settings', methods=['PUT'])
def update_settings():
    """Update system settings"""
    try:
        data = request.json
        trading_frequency_minutes = int(data.get('trading_frequency_minutes', 60))
        trading_fee_rate = float(data.get('trading_fee_rate', 0.001))

        success = db.update_settings(trading_frequency_minutes, trading_fee_rate)

        if success:
            return jsonify({'success': True, 'message': 'Settings updated successfully'})
        else:
            return jsonify({'success': False, 'error': 'Failed to update settings'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/version', methods=['GET'])
def get_version():
    """Get current version information"""
    return jsonify({
        'current_version': __version__,
        'github_repo': GITHUB_REPO_URL,
        'latest_release_url': LATEST_RELEASE_URL
    })

@app.route('/api/check-update', methods=['GET'])
def check_update():
    """Check for GitHub updates"""
    try:
        import requests

        # Get latest release from GitHub
        headers = {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'AITradeGame/1.0'
        }

        # Try to get latest release
        try:
            response = requests.get(
                f"https://api.github.com/repos/{__github_owner__}/{__repo__}/releases/latest",
                headers=headers,
                timeout=5
            )

            if response.status_code == 200:
                release_data = response.json()
                latest_version = release_data.get('tag_name', '').lstrip('v')
                release_url = release_data.get('html_url', '')
                release_notes = release_data.get('body', '')

                # Compare versions
                is_update_available = compare_versions(latest_version, __version__) > 0

                return jsonify({
                    'update_available': is_update_available,
                    'current_version': __version__,
                    'latest_version': latest_version,
                    'release_url': release_url,
                    'release_notes': release_notes,
                    'repo_url': GITHUB_REPO_URL
                })
            else:
                # If API fails, still return current version info
                return jsonify({
                    'update_available': False,
                    'current_version': __version__,
                    'error': 'Could not check for updates'
                })
        except Exception as e:
            print(f"[WARN] GitHub API error: {e}")
            return jsonify({
                'update_available': False,
                'current_version': __version__,
                'error': 'Network error checking updates'
            })

    except Exception as e:
        print(f"[ERROR] Check update failed: {e}")
        return jsonify({
            'update_available': False,
            'current_version': __version__,
            'error': str(e)
        }), 500

# ============ OKX Integration ============

@app.route('/api/okx/test', methods=['POST'])
def okx_test_connection():
    """Test OKX connection"""
    data = request.json
    api_key = data.get('api_key')
    secret = data.get('secret')
    passphrase = data.get('passphrase')
    is_simulation = data.get('is_simulation', True)
    
    try:
        import ccxt
        exchange = ccxt.okx({
            'apiKey': api_key,
            'secret': secret,
            'password': passphrase,
        })
        if is_simulation:
            exchange.set_sandbox_mode(True)
            
        balance = exchange.fetch_balance()
        return jsonify({'success': True, 'balance': balance['total']})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 400

@app.route('/api/okx/trade', methods=['POST'])
def okx_trade():
    """Execute trade on OKX (Demo/Real)"""
    data = request.json
    api_key = data.get('api_key')
    secret = data.get('secret')
    passphrase = data.get('passphrase')
    is_simulation = data.get('is_simulation', True)
    
    symbol = data.get('symbol')
    side = data.get('side') # 'buy' or 'sell'
    amount = data.get('amount')
    
    if not all([api_key, secret, passphrase, symbol, side, amount]):
        return jsonify({'error': 'Missing required parameters'}), 400
        
    try:
        import ccxt
        
        exchange = ccxt.okx({
            'apiKey': api_key,
            'secret': secret,
            'password': passphrase,
            'enableRateLimit': True,
        })
        
        if is_simulation:
            exchange.set_sandbox_mode(True)
            
        # Map symbol (e.g., 'BTC' -> 'BTC/USDT')
        # Assuming spot trading for now
        market_symbol = f"{symbol}/USDT"
        
        # Execute order
        # type='market' for simplicity in this demo
        order = exchange.create_order(market_symbol, 'market', side, amount)
        
        return jsonify({
            'success': True,
            'order_id': order['id'],
            'price': order.get('average') or order.get('price'),
            'filled': order.get('filled'),
            'status': order.get('status')
        })
        
    except Exception as e:
        print(f"[ERROR] OKX Trade failed: {e}")
        return jsonify({'error': str(e)}), 500

def compare_versions(version1, version2):
    """Compare two version strings.

    Returns:
        1 if version1 > version2
        0 if version1 == version2
        -1 if version1 < version2
    """
    def normalize(v):
        # Extract numeric parts from version string
        parts = re.findall(r'\d+', v)
        # Pad with zeros to make them comparable
        return [int(p) for p in parts]

    v1_parts = normalize(version1)
    v2_parts = normalize(version2)

    # Pad shorter version with zeros
    max_len = max(len(v1_parts), len(v2_parts))
    v1_parts.extend([0] * (max_len - len(v1_parts)))
    v2_parts.extend([0] * (max_len - len(v2_parts)))

    # Compare
    if v1_parts > v2_parts:
        return 1
    elif v1_parts < v2_parts:
        return -1
    else:
        return 0

def init_trading_engines():
    try:
        models = db.get_all_models()

        if not models:
            print("[WARN] No trading models found")
            return

        print(f"\n[INIT] Initializing trading engines...")
        for model in models:
            model_id = model['id']
            model_name = model['name']
            strategy_type = model.get('strategy_type', 'llm_json')

            try:
                # Initialize Strategy
                if strategy_type == 'arbitrage':
                    strategy = ArbitrageStrategy(
                        model_id=model_id,
                        market_service=market_service,
                        config={'min_net_spread_pct': -5.0}
                    )
                else:
                    # Get provider info for LLM strategy
                    if not model['provider_id']:
                        print(f"  [WARN] Model {model_id} ({model_name}): Missing provider_id for LLM strategy")
                        continue
                        
                    provider = db.get_provider(model['provider_id'])
                    if not provider:
                        print(f"  [WARN] Model {model_id} ({model_name}): Provider not found")
                        continue

                    ai_trader = AITrader(
                        provider_type=provider.get('provider_type', 'openai'),
                        api_key=provider['api_key'],
                        api_url=provider['api_url'],
                        model_name=model['model_name']
                    )
                    strategy = LLMJsonStrategy(
                        model_id=model_id,
                        trader=ai_trader,
                        config={}
                    )

                trading_engines[model_id] = TradingEngine(
                    model_id=model_id,
                    db=db,
                    market_service=market_service,
                    strategy=strategy,
                    trade_fee_rate=TRADE_FEE_RATE
                )
                print(f"  [OK] Model {model_id} ({model_name}) - {strategy_type}")
            except Exception as e:
                print(f"  [ERROR] Model {model_id} ({model_name}): {e}")
                import traceback
                print(traceback.format_exc())
                continue

        print(f"[INFO] Initialized {len(trading_engines)} engine(s)\n")

    except Exception as e:
        print(f"[ERROR] Init engines failed: {e}\n")

if __name__ == '__main__':
    import webbrowser
    import os
    
    print("\n" + "=" * 60)
    print(f"AITradeGame - Starting... (Updated: {datetime.now().strftime('%H:%M:%S')})")
    print("!!! VERIFY THIS TIMESTAMP MATCHES CURRENT TIME !!!")
    print("=" * 60)
    print("[INFO] Initializing database...")
    
    db.init_db()
    
    print("[INFO] Database initialized")

    # Check if providers exist, if not add default
    try:
        if not db.get_all_providers():
            print("[INIT] Adding default DeepSeek provider...")
            db.add_provider(
                name='DeepSeek',
                api_url='https://api.deepseek.com',
                api_key='sk-placeholder', # User needs to update this
                models='deepseek-chat,deepseek-reasoner'
            )
    except Exception as e:
        print(f"[WARN] Failed to add default provider: {e}")

    print("[INFO] Initializing trading engines...")
    
    init_trading_engines()
    
    if auto_trading:
        trading_thread = threading.Thread(target=trading_loop, daemon=True)
        trading_thread.start()
        print("[INFO] Auto-trading enabled")
    
    print("\n" + "=" * 60)
    print("AITradeGame is running!")
    print("Server: http://localhost:5001")
    print("Press Ctrl+C to stop")
    print("=" * 60 + "\n")
    
    # 自动打开浏览器
    def open_browser():
        time.sleep(1.5)  # 等待服务器启动
        url = "http://localhost:5001"
        try:
            webbrowser.open(url)
            print(f"[INFO] Browser opened: {url}")
        except Exception as e:
            print(f"[WARN] Could not open browser: {e}")
    
    browser_thread = threading.Thread(target=open_browser, daemon=True)
    browser_thread.start()
    
    try:
        print(f"[STARTUP] Attempting to start server on port 5001...")
        app.run(debug=False, host='0.0.0.0', port=5001, use_reloader=False)
    except OSError as e:
        if "Address already in use" in str(e):
            print(f"\n[CRITICAL] Port 5001 is already in use!")
            print(f"[CRITICAL] Please stop the other running instance or kill the process.")
            print(f"[CRITICAL] Error: {e}\n")
        else:
            print(f"\n[CRITICAL] Failed to start server: {e}\n")
        sys.exit(1)
