from .base import StrategyBase, StrategyContext, Signal
from typing import List, Dict, Any

class ArbitrageStrategy(StrategyBase):
    def __init__(self, model_id: int, market_service: Any, config: dict):
        """
        market_service: Instance of MarketDataService
        config: Contains min_net_spread_pct, max_capital_ratio, etc.
        """
        super().__init__(model_id, config)
        self.market_service = market_service

    def generate_signals(self, ctx: StrategyContext) -> List[Signal]:
        # Allow exchanges to be configured via strategy config or context
        configured_exchanges = self.config.get("exchanges", ["Binance", "OKX"])
        
        symbols: List[str] = ctx.extra.get("symbols") if ctx.extra else ["BTC", "ETH"]
        exchanges: List[str] = ctx.extra.get("exchanges") if ctx.extra and ctx.extra.get("exchanges") else configured_exchanges
        
        if not symbols or not exchanges:
            return []

        opps: List[Dict[str, Any]] = []
        
        # Prepare API configs from context
        api_configs = {}
        if ctx.extra and ctx.extra.get("okx"):
            api_configs["okx"] = ctx.extra.get("okx")
            
        for symbol in symbols:
            # Ensure symbol format (e.g. BTC -> BTC/USDT) if needed, but MarketDataService handles it
            orderbooks = self.market_service.get_multi_exchange_orderbooks(exchanges, symbol, api_configs)
            
            if not orderbooks or len(orderbooks) < 2:
                # print(f"[ARB] {symbol}: Insufficient orderbooks ({len(orderbooks) if orderbooks else 0})")
                continue

            # Find best bid (sell high) and best ask (buy low)
            best_bid = max(orderbooks, key=lambda ob: ob["bid_price"])
            best_ask = min(orderbooks, key=lambda ob: ob["ask_price"])
            
            if best_ask["ask_price"] <= 0:
                continue

            # Calculate spread
            spread = (best_bid["bid_price"] - best_ask["ask_price"]) / best_ask["ask_price"] * 100
            net_spread = spread - self._total_fee(best_bid, best_ask)
            
            # Check threshold
            min_spread = self.config.get("min_net_spread_pct", 0.05)

            # Debug log
            print(f"[ARB] {symbol}: Spread {spread:.4f}%, Net {net_spread:.4f}% (Min {min_spread}%)")
            
            # For demo/testing, we might want to be more lenient or strict
            if net_spread >= min_spread:
                size = self._calc_size(best_ask, ctx)
                if size > 0:
                    opps.append({
                        "symbol": symbol,
                        "buy_exchange": best_ask["exchange"],
                        "sell_exchange": best_bid["exchange"],
                        "buy_price": best_ask["ask_price"],
                        "sell_price": best_bid["bid_price"],
                        "spread": spread,
                        "net_spread": net_spread,
                        "size": size
                    })

        signals: List[Signal] = []
        for op in opps:
            # For paper arbitrage, we generate a 'buy' signal followed immediately by a 'close' signal
            # This simulates the atomic nature of arbitrage (Buy Low, Sell High instantly)
            
            # 1. Entry (Buy Low)
            signals.append(Signal(
                symbol=op["symbol"],
                action="buy",
                quantity=op["size"],
                leverage=1,
                meta={"type": "arbitrage_entry", "price": op["buy_price"], **op}
            ))
            
            # 2. Exit (Sell High)
            signals.append(Signal(
                symbol=op["symbol"],
                action="close",
                quantity=op["size"],
                leverage=1,
                meta={"type": "arbitrage_exit", "price": op["sell_price"], **op}
            ))
        return signals

    def _total_fee(self, bid, ask) -> float:
        maker_fee = self.config.get("maker_fee", 0.001)
        taker_fee = self.config.get("taker_fee", 0.001)
        # Assume taker for both legs for safety
        return (taker_fee * 2) * 100

    def _calc_size(self, best_ask, ctx: StrategyContext) -> float:
        cash = ctx.portfolio.get("cash", 0)
        max_ratio = self.config.get("max_capital_ratio", 0.1)
        max_capital = cash * max_ratio
        if best_ask["ask_price"] <= 0:
            return 0.0
        return max_capital / best_ask["ask_price"]
