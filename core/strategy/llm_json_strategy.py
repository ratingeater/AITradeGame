from .base import StrategyBase, StrategyContext, Signal
from core.llm.ai_trader import AITrader
from typing import List

class LLMJsonStrategy(StrategyBase):
    def __init__(self, model_id: int, trader: AITrader, config: dict):
        super().__init__(model_id, config)
        self.trader = trader

    def generate_signals(self, ctx: StrategyContext) -> List[Signal]:
        # Use the existing AITrader logic to generate decisions
        # Note: AITrader expects specific dict structures, which StrategyContext provides
        raw_decisions = self.trader.make_decision(
            ctx.market_state, ctx.portfolio, ctx.account_info
        )
        
        signals: List[Signal] = []
        for coin, decision in raw_decisions.items():
            # Map legacy signals to new Signal object
            signal_str = decision.get("signal", "").lower()
            qty = float(decision.get("quantity", 0) or 0)
            lev = int(decision.get("leverage", 1) or 1)
            
            action = self._map_signal(signal_str)
            
            signals.append(Signal(
                symbol=coin,
                action=action,
                quantity=qty,
                leverage=lev,
                meta=decision,
            ))
        return signals

    def _map_signal(self, signal: str) -> str:
        return {
            "buy_to_enter": "buy",
            "sell_to_enter": "sell",
            "close_position": "close",
            "hold": "hold",
        }.get(signal, "ignore")
