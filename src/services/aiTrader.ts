
import { MarketData } from './marketData';

export interface Portfolio {
  total_value: number;
  cash: number;
  positions: Position[];
}

export interface Position {
  coin: string;
  side: 'long' | 'short';
  quantity: number;
  avg_price: number;
  leverage: number;
}

export interface AccountInfo {
  initial_capital: number;
  total_return: number;
}

export interface TradeDecision {
  signal: 'buy_to_enter' | 'sell_to_enter' | 'hold' | 'close_position';
  quantity: number;
  leverage: number;
  confidence: number;
  justification: string;
}

export class AITraderService {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(apiKey: string, baseUrl: string, model: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async makeDecision(
    marketState: Record<string, MarketData>,
    portfolio: Portfolio,
    accountInfo: AccountInfo
  ): Promise<Record<string, TradeDecision>> {
    const prompt = this.buildPrompt(marketState, portfolio, accountInfo);
    const response = await this.callLLM(prompt);
    return this.parseResponse(response);
  }

  private buildPrompt(
    marketState: Record<string, MarketData>,
    portfolio: Portfolio,
    accountInfo: AccountInfo
  ): string {
    let prompt = `You are an aggressive cryptocurrency trader. Your goal is to maximize profit by actively taking positions.
    
MARKET DATA:
`;
    for (const [coin, data] of Object.entries(marketState)) {
      prompt += `${coin}: $${data.price.toFixed(2)} (${data.change_24h > 0 ? '+' : ''}${data.change_24h.toFixed(2)}%)\n`;
      if (data.indicators) {
        prompt += `  SMA7: $${data.indicators.sma_7.toFixed(2)}, SMA14: $${data.indicators.sma_14.toFixed(2)}, RSI: ${data.indicators.rsi_14.toFixed(1)}\n`;
      }
    }

    prompt += `
ACCOUNT STATUS:
- Initial Capital: $${accountInfo.initial_capital.toFixed(2)}
- Total Value: $${portfolio.total_value.toFixed(2)}
- Cash: $${portfolio.cash.toFixed(2)}
- Total Return: ${accountInfo.total_return.toFixed(2)}%

CURRENT POSITIONS:
`;
    if (portfolio.positions.length > 0) {
      for (const pos of portfolio.positions) {
        prompt += `- ${pos.coin} ${pos.side}: ${pos.quantity.toFixed(4)} @ $${pos.avg_price.toFixed(2)} (${pos.leverage}x)\n`;
      }
    } else {
      prompt += "None\n";
    }

    prompt += `
TRADING RULES:
1. Signals: buy_to_enter (long), sell_to_enter (short), close_position, hold
2. Risk Management: Max 3 positions, Risk 1-5% per trade.
3. STRATEGY: Be decisive. If RSI is < 30, consider BUY. If RSI > 70, consider SELL. If trend is strong, follow it. Do not just HOLD unless market is flat.
4. Output JSON ONLY.

OUTPUT FORMAT:
\`\`\`json
{
  "COIN": {
    "signal": "buy_to_enter|sell_to_enter|hold|close_position",
    "quantity": 0.5,
    "leverage": 1,
    "confidence": 0.8,
    "justification": "Reasoning..."
  }
}
\`\`\`
`;
    return prompt;
  }

  private async callLLM(prompt: string): Promise<string> {
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: 'You are a crypto trading bot. Output JSON only.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.1
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;
    } catch (error) {
      console.error("LLM Call Failed:", error);
      throw error;
    }
  }

  private parseResponse(response: string): Record<string, TradeDecision> {
    try {
      const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) || response.match(/```\s*([\s\S]*?)\s*```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : response;
      return JSON.parse(jsonStr);
    } catch (e) {
      console.error("Failed to parse JSON:", e);
      return {};
    }
  }
}
