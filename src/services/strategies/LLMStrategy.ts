
import { Strategy, StrategyContext, Signal } from './types';
import { AITraderService } from '../aiTrader';

export class LLMStrategy implements Strategy {
  id = 'llm_trader';
  name = 'AI Trader (DeepSeek)';
  description = 'Uses Large Language Models to analyze market structure and sentiment.';
  
  private traderService: AITraderService;

  constructor(apiKey: string, baseUrl: string, model: string) {
    this.traderService = new AITraderService(apiKey, baseUrl, model);
  }

  async generateSignals(ctx: StrategyContext): Promise<Signal[]> {
    const decisions = await this.traderService.makeDecision(
      ctx.marketState,
      ctx.portfolio,
      ctx.accountInfo
    );

    const signals: Signal[] = [];
    for (const [coin, decision] of Object.entries(decisions)) {
      let action: 'buy' | 'sell' | 'hold' | 'close' = 'hold';
      
      if (decision.signal === 'buy_to_enter') action = 'buy';
      else if (decision.signal === 'sell_to_enter') action = 'sell'; // Shorting
      else if (decision.signal === 'close_position') action = 'close';
      else action = 'hold';

      if (action !== 'hold') {
        signals.push({
          symbol: coin,
          action,
          quantity: decision.quantity,
          leverage: decision.leverage,
          confidence: decision.confidence,
          reasoning: decision.justification
        });
      }
    }

    return signals;
  }
}
