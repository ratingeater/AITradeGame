from datetime import datetime
from typing import Dict, List, Any
import json
from core.strategy.base import StrategyBase, StrategyContext, Signal
from core.market.market_data_service import MarketDataService
from infra.database import Database

class TradingEngine:
    def __init__(self, model_id: int, db: Database, market_service: MarketDataService, 
                 strategy: StrategyBase, trade_fee_rate: float = 0.001):
        self.model_id = model_id
        self.db = db
        self.market_service = market_service
        self.strategy = strategy
        self.trade_fee_rate = trade_fee_rate
        self.coins = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE']
    
    def execute_trading_cycle(self) -> Dict:
        print(f"[DEBUG] Engine: Executing cycle for model {self.model_id}")
        try:
            # 1. Get Market State
            market_state = self._get_market_state()
            current_prices = {coin: market_state[coin]['price'] for coin in market_state}
            
            # 2. Get Portfolio
            portfolio = self.db.get_portfolio(self.model_id, current_prices)
            
            # 3. Build Account Info
            account_info = self._build_account_info(portfolio)
            
            # 4. Build Strategy Context
            ctx = StrategyContext(
                model_id=self.model_id,
                account_id=None, # TODO: Support real accounts
                market_state=market_state,
                portfolio=portfolio,
                account_info=account_info,
                settings={"trade_fee_rate": self.trade_fee_rate},
                extra={
                    "symbols": self.coins,
                    "exchanges": ["Binance", "OKX"] # Default for arbitrage
                }
            )
            
            # 5. Generate Signals
            signals = self.strategy.generate_signals(ctx)
            
            # 6. Log Conversation / Signals
            # We try to extract prompt/response from strategy if available, or just log signals
            print(f"[DEBUG] Engine: Logging for model {self.model_id}. Signals: {len(signals)}")
            
            log_entry = None
            if hasattr(self.strategy, 'trader'):
                # LLM Strategy
                log_entry = {
                    "prompt": "Strategy Context (Auto-generated)",
                    "response": json.dumps([s.__dict__ for s in signals], default=str, ensure_ascii=False)
                }
            elif signals:
                # Arbitrage with signals
                log_entry = {
                    "prompt": "Market Scan (Auto-generated)",
                    "response": json.dumps([s.__dict__ for s in signals], default=str, ensure_ascii=False)
                }
            else:
                # Heartbeat
                log_entry = {
                    "prompt": "System Heartbeat",
                    "response": json.dumps({
                        "message": "Market scan complete. No arbitrage opportunities found matching criteria.",
                        "market_data_snapshot": {k: v['price'] for k, v in market_state.items()}
                    }, default=str, ensure_ascii=False)
                }
            
            if log_entry:
                try:
                    self.db.add_conversation(
                        self.model_id,
                        user_prompt=log_entry["prompt"],
                        ai_response=log_entry["response"],
                        cot_trace=''
                    )
                    print(f"[DEBUG] Engine: Log saved to DB for model {self.model_id}")
                except Exception as e:
                    print(f"[ERROR] Failed to save log to DB: {e}")
            
            # 7. Execute Signals
            execution_results = self._execute_signals(signals, market_state, portfolio)
            
            # 8. Update Account Value History
            updated_portfolio = self.db.get_portfolio(self.model_id, current_prices)
            self.db.record_account_value(
                self.model_id,
                updated_portfolio['total_value'],
                updated_portfolio['cash'],
                updated_portfolio['positions_value']
            )
            
            return {
                'success': True,
                'signals': [s.__dict__ for s in signals],
                'executions': execution_results,
                'portfolio': updated_portfolio
            }
            
        except Exception as e:
            error_msg = f"Trading cycle failed: {str(e)}"
            print(f"[ERROR] {error_msg}")
            import traceback
            print(traceback.format_exc())
            
            # Log error to DB so user sees it in UI
            try:
                self.db.add_conversation(
                    self.model_id,
                    user_prompt="System Error",
                    ai_response=json.dumps({
                        "error": error_msg,
                        "details": traceback.format_exc()
                    }, default=str, ensure_ascii=False),
                    cot_trace=''
                )
            except Exception as db_e:
                print(f"[CRITICAL] Failed to log error to DB: {db_e}")

            return {
                'success': False,
                'error': str(e)
            }
    
    def _get_market_state(self) -> Dict:
        # Use MarketDataService's get_spot_snapshot
        return self.market_service.get_spot_snapshot(self.coins)
    
    def _build_account_info(self, portfolio: Dict) -> Dict:
        model = self.db.get_model(self.model_id)
        initial_capital = model['initial_capital']
        total_value = portfolio['total_value']
        total_return = ((total_value - initial_capital) / initial_capital) * 100
        
        return {
            'current_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'total_return': total_return,
            'initial_capital': initial_capital
        }
    
    def _execute_signals(self, signals: List[Signal], market_state: Dict, 
                          portfolio: Dict) -> list:
        results = []
        
        for signal in signals:
            coin = signal.symbol
            # Handle arbitrage symbols like "BTC" or "BTC/USDT"
            # market_state keys are typically "BTC"
            market_coin = coin.split('/')[0] if '/' in coin else coin
            
            if market_coin not in self.coins and market_coin not in market_state:
                # Try to fetch if missing? For now skip
                if market_coin not in market_state:
                     continue

            try:
                if signal.action == 'buy':
                    result = self._execute_buy(market_coin, signal, market_state, portfolio)
                elif signal.action == 'sell':
                    result = self._execute_sell(market_coin, signal, market_state, portfolio)
                elif signal.action == 'close':
                    result = self._execute_close(market_coin, signal, market_state, portfolio)
                elif signal.action == 'hold':
                    result = {'coin': coin, 'signal': 'hold', 'message': 'Hold position'}
                else:
                    result = {'coin': coin, 'message': f'Ignored action: {signal.action}'}
                
                results.append(result)
                
            except Exception as e:
                results.append({'coin': coin, 'error': str(e)})
        
        return results
    
    def _execute_buy(self, coin: str, signal: Signal, market_state: Dict, 
                    portfolio: Dict) -> Dict:
        quantity = signal.quantity
        leverage = signal.leverage
        # Use price from signal if available (e.g. for Arbitrage), otherwise market price
        price = signal.meta.get('price', market_state[coin]['price'])
        
        if quantity <= 0:
            return {'coin': coin, 'error': 'Invalid quantity'}
        
        # Calculate amounts
        trade_amount = quantity * price
        trade_fee = trade_amount * self.trade_fee_rate
        required_margin = (quantity * price) / leverage
        
        # Check cash
        total_required = required_margin + trade_fee
        if total_required > portfolio['cash']:
            return {'coin': coin, 'error': 'Insufficient cash (including fees)'}
        
        # Update DB
        self.db.update_position(
            self.model_id, coin, quantity, price, leverage, 'long'
        )
        
        self.db.add_trade(
            self.model_id, coin, 'buy', quantity, 
            price, leverage, 'long', pnl=0, fee=trade_fee
        )

        # Update in-memory portfolio for subsequent signals in this cycle
        portfolio['cash'] -= total_required
        
        # Check if position exists in memory
        existing_pos = next((p for p in portfolio['positions'] if p['coin'] == coin and p['side'] == 'long'), None)
        
        if existing_pos:
            # Update existing position
            total_qty = existing_pos['quantity'] + quantity
            avg_price = ((existing_pos['quantity'] * existing_pos['avg_price']) + (quantity * price)) / total_qty
            existing_pos['quantity'] = total_qty
            existing_pos['avg_price'] = avg_price
        else:
            # Create new position
            portfolio['positions'].append({
                'model_id': self.model_id,
                'coin': coin,
                'quantity': quantity,
                'avg_price': price,
                'leverage': leverage,
                'side': 'long',
                'updated_at': datetime.now().isoformat()
            })
        
        return {
            'coin': coin,
            'signal': 'buy',
            'quantity': quantity,
            'price': price,
            'leverage': leverage,
            'fee': trade_fee,
            'message': f'Long {quantity:.4f} {coin} @ ${price:.2f} (Fee: ${trade_fee:.2f})'
        }
    
    def _execute_sell(self, coin: str, signal: Signal, market_state: Dict, 
                 portfolio: Dict) -> Dict:
        quantity = signal.quantity
        leverage = signal.leverage
        # Use price from signal if available
        price = signal.meta.get('price', market_state[coin]['price'])
        
        if quantity <= 0:
            return {'coin': coin, 'error': 'Invalid quantity'}
        
        trade_amount = quantity * price
        trade_fee = trade_amount * self.trade_fee_rate
        required_margin = (quantity * price) / leverage
        
        total_required = required_margin + trade_fee
        if total_required > portfolio['cash']:
            return {'coin': coin, 'error': 'Insufficient cash (including fees)'}
        
        self.db.update_position(
            self.model_id, coin, quantity, price, leverage, 'short'
        )
        
        self.db.add_trade(
            self.model_id, coin, 'sell', quantity, 
            price, leverage, 'short', pnl=0, fee=trade_fee
        )

        # Update in-memory portfolio for subsequent signals in this cycle
        portfolio['cash'] -= total_required
        
        # Check if position exists in memory
        existing_pos = next((p for p in portfolio['positions'] if p['coin'] == coin and p['side'] == 'short'), None)
        
        if existing_pos:
            # Update existing position
            total_qty = existing_pos['quantity'] + quantity
            avg_price = ((existing_pos['quantity'] * existing_pos['avg_price']) + (quantity * price)) / total_qty
            existing_pos['quantity'] = total_qty
            existing_pos['avg_price'] = avg_price
        else:
            # Create new position
            portfolio['positions'].append({
                'model_id': self.model_id,
                'coin': coin,
                'quantity': quantity,
                'avg_price': price,
                'leverage': leverage,
                'side': 'short',
                'updated_at': datetime.now().isoformat()
            })
        
        return {
            'coin': coin,
            'signal': 'sell',
            'quantity': quantity,
            'price': price,
            'leverage': leverage,
            'fee': trade_fee,
            'message': f'Short {quantity:.4f} {coin} @ ${price:.2f} (Fee: ${trade_fee:.2f})'
        }
    
    def _execute_close(self, coin: str, signal: Signal, market_state: Dict, 
                    portfolio: Dict) -> Dict:
        position = None
        for pos in portfolio['positions']:
            if pos['coin'] == coin:
                position = pos
                break
        
        if not position:
            return {'coin': coin, 'error': 'Position not found'}
        
        # Use price from signal if available
        current_price = signal.meta.get('price', market_state[coin]['price'])
        entry_price = position['avg_price']
        quantity = position['quantity']
        side = position['side']
        
        if side == 'long':
            gross_pnl = (current_price - entry_price) * quantity
        else:  # short
            gross_pnl = (entry_price - current_price) * quantity
        
        trade_amount = quantity * current_price
        trade_fee = trade_amount * self.trade_fee_rate
        net_pnl = gross_pnl - trade_fee
        
        self.db.close_position(self.model_id, coin, side)
        
        self.db.add_trade(
            self.model_id, coin, 'close', quantity,
            current_price, position['leverage'], side, pnl=net_pnl, fee=trade_fee
        )

        # Update in-memory portfolio for subsequent signals in this cycle
        # Add back initial margin + net pnl
        initial_margin = (quantity * entry_price) / position['leverage']
        portfolio['cash'] += initial_margin + net_pnl
        
        # Remove position from memory
        portfolio['positions'] = [p for p in portfolio['positions'] if not (p['coin'] == coin and p['side'] == side)]
        
        return {
            'coin': coin,
            'signal': 'close',
            'quantity': quantity,
            'price': current_price,
            'pnl': net_pnl,
            'fee': trade_fee,
            'message': f'Close {coin}, Gross P&L: ${gross_pnl:.2f}, Fee: ${trade_fee:.2f}, Net P&L: ${net_pnl:.2f}'
        }
