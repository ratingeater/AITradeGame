from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Dict, Any, List, Optional

@dataclass
class StrategyContext:
    model_id: int
    account_id: Optional[int]
    market_state: Dict[str, Any]      # Market data + indicators
    portfolio: Dict[str, Any]         # Positions + Cash + PnL
    account_info: Dict[str, Any]      # Initial capital, returns, etc.
    settings: Dict[str, Any]          # Fees, risk config
    extra: Optional[Dict[str, Any]] = None      # Other data (e.g. multi-exchange data)

@dataclass
class Signal:
    symbol: str
    action: str        # 'buy', 'sell', 'close', 'hold', 'ignore'
    quantity: float
    leverage: int
    meta: Dict[str, Any]

class StrategyBase(ABC):
    def __init__(self, model_id: int, config: Dict[str, Any]):
        self.model_id = model_id
        self.config = config

    @abstractmethod
    def generate_signals(self, ctx: StrategyContext) -> List[Signal]:
        """Core method: Generate trading signals from context"""
        pass
