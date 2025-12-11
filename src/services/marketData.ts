
export interface MarketData {
  price: number;
  change_24h: number;
  indicators?: {
    sma_7: number;
    sma_14: number;
    rsi_14: number;
  };
}

export class MarketDataService {
  private baseUrl = 'https://min-api.cryptocompare.com/data';

  async getMarketState(coins: string[]): Promise<Record<string, MarketData>> {
    const results: Record<string, MarketData> = {};
    const fsyms = coins.join(',');
    
    try {
      // 1. Get Price & Change
      const priceRes = await fetch(`${this.baseUrl}/pricemultifull?fsyms=${fsyms}&tsyms=USD`);
      const priceData = await priceRes.json();
      
      if (priceData.Response === 'Error') {
        throw new Error(priceData.Message);
      }

      // Process each coin
      await Promise.all(coins.map(async (coin) => {
        try {
          const raw = priceData.RAW?.[coin]?.USD;
          if (!raw) throw new Error(`No data for ${coin}`);

          // 2. Get History for Indicators
          const histRes = await fetch(`${this.baseUrl}/v2/histoday?fsym=${coin}&tsym=USD&limit=20`);
          const histData = await histRes.json();
          
          let indicators;
          if (histData.Response === 'Success' && histData.Data?.Data) {
            const closes = histData.Data.Data.map((d: any) => d.close);
            indicators = this.calculateIndicators(closes);
          }

          results[coin] = {
            price: raw.PRICE,
            change_24h: raw.CHANGEPCT24HOUR,
            indicators
          };
        } catch (e) {
          console.warn(`Partial fetch error for ${coin}:`, e);
          // Fallback to just price if history fails
          if (priceData.RAW?.[coin]?.USD) {
             const raw = priceData.RAW[coin].USD;
             results[coin] = {
               price: raw.PRICE,
               change_24h: raw.CHANGEPCT24HOUR
             };
          } else {
            // Last resort fallback
            results[coin] = this.getMockData(coin);
          }
        }
      }));

    } catch (e) {
      console.error("Market Data Fetch Failed:", e);
      // Fallback to mock data for all
      for (const coin of coins) {
        results[coin] = this.getMockData(coin);
      }
    }

    return results;
  }

  private calculateIndicators(prices: number[]) {
    if (prices.length < 14) return undefined;
    
    // SMA
    const sma7 = this.calculateSMA(prices, 7);
    const sma14 = this.calculateSMA(prices, 14);
    
    // RSI (Simplified 14-period)
    const rsi14 = this.calculateRSI(prices, 14);

    return {
      sma_7: sma7,
      sma_14: sma14,
      rsi_14: rsi14
    };
  }

  private calculateSMA(data: number[], period: number): number {
    if (data.length < period) return 0;
    const slice = data.slice(-period);
    const sum = slice.reduce((a, b) => a + b, 0);
    return sum / period;
  }

  private calculateRSI(data: number[], period: number): number {
    if (data.length < period + 1) return 50;
    
    let gains = 0;
    let losses = 0;
    
    for (let i = data.length - period; i < data.length; i++) {
      const change = data[i] - data[i - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }
    
    if (losses === 0) return 100;
    if (gains === 0) return 0;
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  private getMockData(coin: string): MarketData {
    const basePrice = this.getBasePrice(coin);
    const volatility = 0.02; 
    const change = (Math.random() * volatility * 2) - volatility;
    const currentPrice = basePrice * (1 + change);
    
    return {
      price: currentPrice,
      change_24h: change * 100,
      indicators: {
        sma_7: currentPrice * (1 + (Math.random() * 0.01 - 0.005)),
        sma_14: currentPrice * (1 + (Math.random() * 0.01 - 0.005)),
        rsi_14: 30 + Math.random() * 40 
      }
    };
  }

  private getBasePrice(coin: string): number {
    const prices: Record<string, number> = {
      'BTC': 65000,
      'ETH': 3500,
      'SOL': 150,
      'BNB': 600,
      'XRP': 0.6,
      'DOGE': 0.15
    };
    return prices[coin] || 100;
  }
}
