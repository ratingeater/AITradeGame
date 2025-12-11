
import { Strategy, StrategyContext, Signal } from './types';

export class ArbitrageStrategy implements Strategy {
  id = 'arbitrage_bot';
  name = 'Cross-CEX Arbitrage';
  description = 'Monitors price differences between exchanges (e.g., Binance vs OKX) to execute risk-free trades.';

  async generateSignals(ctx: StrategyContext): Promise<Signal[]> {
    const signals: Signal[] = [];
    const { marketState, portfolio } = ctx;

    // Simulate checking multiple exchanges
    // In a real app, this would fetch real orderbooks from CCXT
    const exchanges = ['Binance', 'OKX', 'Bybit'];
    
    for (const [coin, data] of Object.entries(marketState)) {
      // Simulate price variations between exchanges based on volatility
      // Higher volatility = higher chance of spread
      const volatility = Math.abs(data.change_24h) / 100; 
      const basePrice = data.price;
      
      // Generate mock prices for exchanges
      const exchangePrices = exchanges.map(ex => ({
        name: ex,
        price: basePrice * (1 + (Math.random() * volatility * 0.5 - volatility * 0.25))
      }));

      // Find best bid (sell high) and best ask (buy low)
      const bestAsk = exchangePrices.reduce((prev, curr) => prev.price < curr.price ? prev : curr); // Buy low
      const bestBid = exchangePrices.reduce((prev, curr) => prev.price > curr.price ? prev : curr); // Sell high

      const spreadPct = ((bestBid.price - bestAsk.price) / bestAsk.price) * 100;
      const minSpread = 0.3; // Minimum 0.3% spread to trade

      if (spreadPct > minSpread) {
        // Found arbitrage opportunity
        const maxCapital = portfolio.cash * 0.2; // Use max 20% of cash per trade
        const quantity = maxCapital / bestAsk.price;

        // Arbitrage is atomic: Buy Low and Sell High immediately
        // We generate a BUY signal to enter
        signals.push({
          symbol: coin,
          action: 'buy', 
          quantity: quantity,
          leverage: 1,
          price: bestAsk.price, // Buy at lower price
          confidence: 1.0,
          reasoning: `Arbitrage Entry: Buy on ${bestAsk.name} @ $${bestAsk.price.toFixed(2)}`,
          meta: {
            type: 'arbitrage_entry',
            exchange: bestAsk.name,
            price: bestAsk.price
          }
        });

        // And a CLOSE signal to exit immediately with profit
        signals.push({
          symbol: coin,
          action: 'close',
          quantity: quantity,
          leverage: 1,
          price: bestBid.price, // Sell at higher price
          confidence: 1.0,
          reasoning: `Arbitrage Exit: Sell on ${bestBid.name} @ $${bestBid.price.toFixed(2)} (Spread: ${spreadPct.toFixed(2)}%)`,
          meta: {
            type: 'arbitrage_exit',
            exchange: bestBid.name,
            price: bestBid.price,
            spread: spreadPct
          }
        });
      }
    }

    return signals;
  }
}
