"""
Market data module - Binance API integration
"""
import requests
import time
from typing import Dict, List

class MarketDataService:
    """Unified Market Data Service"""
    
    def __init__(self, default_exchange: str = "binance"):
        self.default_exchange = default_exchange
        self.binance_base_url = "https://api.binance.com/api/v3"
        self.coingecko_base_url = "https://api.coingecko.com/api/v3"
        self.cryptocompare_base_url = "https://min-api.cryptocompare.com/data"
        
        # Binance symbol mapping
        self.binance_symbols = {
            'BTC': 'BTCUSDT',
            'ETH': 'ETHUSDT',
            'SOL': 'SOLUSDT',
            'BNB': 'BNBUSDT',
            'XRP': 'XRPUSDT',
            'DOGE': 'DOGEUSDT'
        }
        
        # CoinGecko mapping for technical indicators
        self.coingecko_mapping = {
            'BTC': 'bitcoin',
            'ETH': 'ethereum',
            'SOL': 'solana',
            'BNB': 'binancecoin',
            'XRP': 'ripple',
            'DOGE': 'dogecoin'
        }
        
        self._cache = {}
        self._cache_time = {}
        self._cache_duration = 5  # Cache for 5 seconds
        
        self.api_configs = {} # Store API configs for CCXT

    def set_api_configs(self, configs: Dict):
        """Set API configurations for exchanges"""
        self.api_configs = configs

    def get_spot_snapshot(self, coins: List[str]) -> Dict[str, dict]:
        """Get current prices and indicators for multiple coins"""
        # Reuse existing get_current_prices logic but return more structured data
        prices = self.get_current_prices(coins)
        snapshot = {}
        for coin, data in prices.items():
            # Calculate indicators (cached internally if possible, but here we call it)
            indicators = self.calculate_technical_indicators(coin)
            snapshot[coin] = {
                "price": data['price'],
                "change_24h": data['change_24h'],
                "indicators": indicators
            }
        return snapshot

    def get_multi_exchange_orderbooks(self, exchanges: List[str], symbol: str, api_configs: Dict = None) -> List[Dict]:
        """
        Get orderbooks from multiple exchanges for a symbol.
        Uses CCXT for real data, falls back to simulation if failed.
        api_configs: Dict of exchange configs, e.g. {'okx': {'apiKey': '...', ...}}
        """
        import random
        import ccxt
        
        orderbooks = []
        
        # Try to fetch real data first
        try:
            for ex_name in exchanges:
                try:
                    # Initialize exchange
                    if not hasattr(ccxt, ex_name.lower()):
                        continue
                        
                    exchange_class = getattr(ccxt, ex_name.lower())
                    
                    # Prepare config
                    config = {
                        'enableRateLimit': True,
                        'timeout': 3000
                    }
                    
                    # Inject API keys if available
                    if api_configs and ex_name.lower() in api_configs:
                        ex_config = api_configs[ex_name.lower()]
                        if ex_config.get('apiKey'):
                            config['apiKey'] = ex_config['apiKey']
                            config['secret'] = ex_config['secret']
                            if ex_config.get('passphrase'):
                                config['password'] = ex_config['passphrase']
                            
                            # Set sandbox mode if configured
                            if ex_config.get('isSimulation'):
                                exchange = exchange_class(config)
                                exchange.set_sandbox_mode(True)
                            else:
                                exchange = exchange_class(config)
                        else:
                            exchange = exchange_class(config)
                    else:
                        exchange = exchange_class(config)
                    
                    # Map symbol: BTC -> BTC/USDT
                    ccxt_symbol = f"{symbol}/USDT" if '/' not in symbol else symbol
                    
                    # Fetch order book
                    ob = exchange.fetch_order_book(ccxt_symbol, limit=5)
                    
                    if ob['bids'] and ob['asks']:
                        orderbooks.append({
                            "exchange": ex_name,
                            "symbol": symbol,
                            "bid_price": ob['bids'][0][0],
                            "ask_price": ob['asks'][0][0],
                            "bid_qty": ob['bids'][0][1],
                            "ask_qty": ob['asks'][0][1]
                        })
                    else:
                        print(f"[WARN] {ex_name} returned empty orderbook for {symbol}")
                except Exception as e:
                    print(f"[WARN] Failed to fetch {ex_name} orderbook: {e}")
                    continue
                    
        except Exception as e:
            print(f"[ERROR] CCXT fetch failed: {e}")
            
        print(f"[DEBUG] Orderbooks fetched: {len(orderbooks)}/{len(exchanges)}")
            
        # If we got data, return it
        if len(orderbooks) == len(exchanges):
            return orderbooks
            
        # If we have partial data (e.g. OKX worked but Binance failed), simulate the rest
        # This ensures strategies that need 2 exchanges (Arbitrage) can still run in "Game" mode
        if orderbooks and len(orderbooks) < len(exchanges):
            print(f"[INFO] Partial market data ({len(orderbooks)}/{len(exchanges)}). Simulating missing exchanges for {symbol}.")
            
            # Identify missing exchanges
            found_exchanges = {ob['exchange'] for ob in orderbooks}
            missing_exchanges = [ex for ex in exchanges if ex not in found_exchanges]
            
            # Use the first valid orderbook as base
            base_ob = orderbooks[0]
            base_price = (base_ob['bid_price'] + base_ob['ask_price']) / 2
            
            for ex in missing_exchanges:
                # Simulate small deviation to create arbitrage opportunity
                # Random deviation between -0.5% and +0.5% (Total 1% range) to cover fees (0.2%)
                deviation = (random.random() - 0.5) * 0.01 * base_price 
                price = base_price + deviation
                spread = price * 0.001 # 0.1% spread
                
                orderbooks.append({
                    "exchange": ex,
                    "symbol": symbol,
                    "bid_price": price - spread/2,
                    "ask_price": price + spread/2,
                    "bid_qty": random.uniform(0.1, 2.0),
                    "ask_qty": random.uniform(0.1, 2.0),
                    "is_simulated": True
                })
                
            return orderbooks

        # Fallback to simulation if ALL failed
        return self._simulate_orderbooks(exchanges, symbol)

    def _simulate_orderbooks(self, exchanges: List[str], symbol: str) -> List[Dict]:
        """Simulate orderbooks for testing"""
        import random
        
        # Get base price
        base_price_data = self.get_current_prices([symbol.split('/')[0] if '/' in symbol else symbol])
        base_price = list(base_price_data.values())[0]['price'] if base_price_data else 50000
        
        orderbooks = []
        for ex in exchanges:
            # Simulate small deviation
            deviation = (random.random() - 0.5) * 0.01 * base_price # +/- 0.5%
            price = base_price + deviation
            
            # Simulate bid/ask spread
            spread = price * 0.001 # 0.1% spread
            
            orderbooks.append({
                "exchange": ex,
                "symbol": symbol,
                "bid_price": price - spread/2,
                "ask_price": price + spread/2,
                "bid_qty": random.uniform(0.1, 2.0),
                "ask_qty": random.uniform(0.1, 2.0)
            })
        return orderbooks

    def get_current_prices(self, coins: List[str]) -> Dict[str, float]:
        """Get current prices from CCXT (if configured) -> CryptoCompare -> Binance -> CoinGecko"""
        # Check cache
        cache_key = 'prices_' + '_'.join(sorted(coins))
        if cache_key in self._cache:
            if time.time() - self._cache_time[cache_key] < self._cache_duration:
                return self._cache[cache_key]
        
        prices = {}

        # 0. Try CCXT/OKX if configured
        if self.api_configs and 'okx' in self.api_configs:
            try:
                import ccxt
                okx_config = self.api_configs['okx']
                if okx_config.get('apiKey'):
                    exchange = ccxt.okx({
                        'apiKey': okx_config['apiKey'],
                        'secret': okx_config['secret'],
                        'password': okx_config.get('passphrase'),
                        'enableRateLimit': True,
                        'timeout': 3000
                    })
                    if okx_config.get('isSimulation'):
                        exchange.set_sandbox_mode(True)
                    
                    # Fetch tickers
                    # Map coins to symbols
                    symbols = [f"{coin}/USDT" for coin in coins]
                    tickers = exchange.fetch_tickers(symbols)
                    
                    for symbol, ticker in tickers.items():
                        coin = symbol.split('/')[0]
                        if coin in coins:
                            prices[coin] = {
                                'price': float(ticker['last']),
                                'change_24h': float(ticker['percentage'] or 0)
                            }
                    
                    if len(prices) == len(coins):
                        # Update cache
                        self._cache[cache_key] = prices
                        self._cache_time[cache_key] = time.time()
                        return prices
            except Exception as e:
                print(f"[WARN] OKX Price Fetch failed: {e}")

        # Try CryptoCompare first (Most reliable for public access)
        try:
            return self._get_prices_from_cryptocompare(coins)
        except Exception as e:
            print(f"[WARN] CryptoCompare failed: {e}, trying Binance...")

        try:
            # Batch fetch Binance 24h ticker data
            symbols = [self.binance_symbols.get(coin) for coin in coins if coin in self.binance_symbols]
            
            if symbols:
                # Build symbols parameter
                symbols_param = '[' + ','.join([f'"{s}"' for s in symbols]) + ']'
                
                response = requests.get(
                    f"{self.binance_base_url}/ticker/24hr",
                    params={'symbols': symbols_param},
                    timeout=5
                )
                response.raise_for_status()
                data = response.json()
                
                # Parse data
                for item in data:
                    symbol = item['symbol']
                    # Find corresponding coin
                    for coin, binance_symbol in self.binance_symbols.items():
                        if binance_symbol == symbol:
                            prices[coin] = {
                                'price': float(item['lastPrice']),
                                'change_24h': float(item['priceChangePercent'])
                            }
                            break
            
            # Update cache
            self._cache[cache_key] = prices
            self._cache_time[cache_key] = time.time()
            
            return prices
            
        except Exception as e:
            print(f"[WARN] Binance API failed: {e}, trying CoinGecko...")
            # Fallback to CoinGecko
            return self._get_prices_from_coingecko(coins)
    
    def _get_prices_from_cryptocompare(self, coins: List[str]) -> Dict[str, float]:
        """Primary: Fetch prices from CryptoCompare"""
        try:
            # Map coins to symbols (CryptoCompare uses standard tickers like BTC, ETH)
            fsyms = ','.join(coins)
            
            response = requests.get(
                f"{self.cryptocompare_base_url}/pricemultifull",
                params={
                    'fsyms': fsyms,
                    'tsyms': 'USD'
                },
                timeout=5
            )
            response.raise_for_status()
            data = response.json()
            
            if 'RAW' not in data:
                raise ValueError("Invalid response from CryptoCompare")
                
            prices = {}
            for coin in coins:
                if coin in data['RAW'] and 'USD' in data['RAW'][coin]:
                    raw = data['RAW'][coin]['USD']
                    prices[coin] = {
                        'price': float(raw['PRICE']),
                        'change_24h': float(raw['CHANGEPCT24HOUR'])
                    }
            
            # Update cache
            cache_key = 'prices_' + '_'.join(sorted(coins))
            self._cache[cache_key] = prices
            self._cache_time[cache_key] = time.time()
            
            return prices
        except Exception as e:
            raise e

    def _get_prices_from_coingecko(self, coins: List[str]) -> Dict[str, float]:
        """Fallback: Fetch prices from CoinGecko"""
        try:
            coin_ids = [self.coingecko_mapping.get(coin, coin.lower()) for coin in coins]
            
            response = requests.get(
                f"{self.coingecko_base_url}/simple/price",
                params={
                    'ids': ','.join(coin_ids),
                    'vs_currencies': 'usd',
                    'include_24hr_change': 'true'
                },
                timeout=10
            )
            response.raise_for_status()
            data = response.json()
            
            prices = {}
            for coin in coins:
                coin_id = self.coingecko_mapping.get(coin, coin.lower())
                if coin_id in data:
                    prices[coin] = {
                        'price': data[coin_id]['usd'],
                        'change_24h': data[coin_id].get('usd_24h_change', 0)
                    }
            
            return prices
        except Exception as e:
            print(f"[ERROR] CoinGecko fallback also failed: {e}")
            # Final Fallback: Mock Data
            import random
            mock_prices = {}
            base_prices = {
                'BTC': 65000, 'ETH': 3500, 'SOL': 150, 
                'BNB': 600, 'XRP': 0.6, 'DOGE': 0.15
            }
            for coin in coins:
                base = base_prices.get(coin, 100)
                mock_prices[coin] = {
                    'price': base * (1 + (random.random() - 0.5) * 0.05),
                    'change_24h': (random.random() - 0.5) * 5
                }
            return mock_prices
    
    def get_market_data(self, coin: str) -> Dict:
        """Get detailed market data from CoinGecko"""
        coin_id = self.coingecko_mapping.get(coin, coin.lower())
        
        try:
            response = requests.get(
                f"{self.coingecko_base_url}/coins/{coin_id}",
                params={'localization': 'false', 'tickers': 'false', 'community_data': 'false'},
                timeout=10
            )
            response.raise_for_status()
            data = response.json()
            
            market_data = data.get('market_data', {})
            
            return {
                'current_price': market_data.get('current_price', {}).get('usd', 0),
                'market_cap': market_data.get('market_cap', {}).get('usd', 0),
                'total_volume': market_data.get('total_volume', {}).get('usd', 0),
                'price_change_24h': market_data.get('price_change_percentage_24h', 0),
                'price_change_7d': market_data.get('price_change_percentage_7d', 0),
                'high_24h': market_data.get('high_24h', {}).get('usd', 0),
                'low_24h': market_data.get('low_24h', {}).get('usd', 0),
            }
        except Exception as e:
            print(f"[ERROR] Failed to get market data for {coin}: {e}")
            return {}
    
    def get_historical_prices(self, coin: str, days: int = 7) -> List[Dict]:
        """Get historical prices from CryptoCompare (Primary) -> CoinGecko"""
        
        # Try CryptoCompare first
        try:
            response = requests.get(
                f"{self.cryptocompare_base_url}/v2/histoday",
                params={
                    'fsym': coin,
                    'tsym': 'USD',
                    'limit': days
                },
                timeout=5
            )
            response.raise_for_status()
            data = response.json()
            
            if data.get('Response') == 'Success' and data.get('Data', {}).get('Data'):
                prices = []
                for item in data['Data']['Data']:
                    prices.append({
                        'timestamp': item['time'] * 1000, # Convert to ms
                        'price': float(item['close'])
                    })
                return prices
        except Exception as e:
            print(f"[WARN] CryptoCompare history failed for {coin}: {e}, trying CoinGecko...")

        coin_id = self.coingecko_mapping.get(coin, coin.lower())
        
        try:
            response = requests.get(
                f"{self.coingecko_base_url}/coins/{coin_id}/market_chart",
                params={'vs_currency': 'usd', 'days': days},
                timeout=10
            )
            response.raise_for_status()
            data = response.json()
            
            prices = []
            for price_data in data.get('prices', []):
                prices.append({
                    'timestamp': price_data[0],
                    'price': price_data[1]
                })
            
            return prices
        except Exception as e:
            print(f"[ERROR] Failed to get historical prices for {coin}: {e}")
            # Fallback to Mock Data if everything fails
            import random
            now = time.time() * 1000
            mock_prices = []
            base_price = 50000 if coin == 'BTC' else 3000 if coin == 'ETH' else 100
            for i in range(days):
                mock_prices.append({
                    'timestamp': now - ((days - i) * 24 * 3600 * 1000),
                    'price': base_price * (1 + (random.random() - 0.5) * 0.1)
                })
            return mock_prices
    
    def calculate_technical_indicators(self, coin: str) -> Dict:
        """Calculate technical indicators"""
        historical = self.get_historical_prices(coin, days=14)
        
        if not historical or len(historical) < 14:
            return {}
        
        prices = [p['price'] for p in historical]
        
        # Simple Moving Average
        sma_7 = sum(prices[-7:]) / 7 if len(prices) >= 7 else prices[-1]
        sma_14 = sum(prices[-14:]) / 14 if len(prices) >= 14 else prices[-1]
        
        # Simple RSI calculation
        changes = [prices[i] - prices[i-1] for i in range(1, len(prices))]
        gains = [c if c > 0 else 0 for c in changes]
        losses = [-c if c < 0 else 0 for c in changes]
        
        avg_gain = sum(gains[-14:]) / 14 if gains else 0
        avg_loss = sum(losses[-14:]) / 14 if losses else 0
        
        if avg_loss == 0:
            rsi = 100
        else:
            rs = avg_gain / avg_loss
            rsi = 100 - (100 / (1 + rs))
        
        return {
            'sma_7': sma_7,
            'sma_14': sma_14,
            'rsi_14': rsi,
            'current_price': prices[-1],
            'price_change_7d': ((prices[-1] - prices[0]) / prices[0]) * 100 if prices[0] > 0 else 0
        }

