
import { MarketData } from '../marketData';
import { Portfolio, AccountInfo } from '../aiTrader';

export interface StrategyContext {
  marketState: Record<string, MarketData>;
  portfolio: Portfolio;
  accountInfo: AccountInfo;
  extra?: any;
}

export interface Signal {
  symbol: string;
  action: 'buy' | 'sell' | 'hold' | 'close';
  quantity: number;
  leverage: number;
  price?: number; // Optional execution price override
  confidence?: number;
  reasoning?: string;
  meta?: any;
}

export interface Strategy {
  id: string;
  name: string;
  description: string;
  generateSignals(ctx: StrategyContext): Promise<Signal[]>;
}
