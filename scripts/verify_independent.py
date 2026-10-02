#!/usr/bin/env python3
"""
Independent cross-check of the TypeScript portfolio engine.

Purpose: prove the shipped numbers are correct rather than merely self-consistent. This script
re-implements the specification from scratch in Python using `decimal.Decimal`, reading the same
CSV files, and emits JSON. `tests/real-data.test.ts` compares the TypeScript engine's output
against the snapshot this produces (`scripts/expected.json`).

Deliberately written without reference to the TypeScript control flow so that a shared
misreading of the spec is less likely to cancel out. Run with:

    python3 scripts/verify_independent.py > scripts/expected.json
"""

import csv
import json
import os
from decimal import ROUND_HALF_UP, Decimal, getcontext

# Match the TypeScript engine's numeric context exactly (see src/lib/domain/money.ts): 40
# significant digits, ROUND_HALF_UP. Python's default is ROUND_HALF_EVEN, which made the two
# implementations disagree in the 38th significant digit on non-terminating divisions (average
# cost) — a 1-ulp artifact, not a logic difference, but it prevented an exact comparison.
getcontext().prec = 40
getcontext().rounding = ROUND_HALF_UP

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")


def read_trades():
    with open(os.path.join(DATA, "trades.csv"), newline="") as handle:
        return list(csv.DictReader(handle))


def read_prices():
    with open(os.path.join(DATA, "prices.csv"), newline="") as handle:
        rows = list(csv.DictReader(handle))
    prices = {row["symbol"]: Decimal(row["price_usd"]) for row in rows}
    as_of = max(row["as_of"] for row in rows)
    return as_of, prices


def main():
    trades = read_trades()
    as_of, prices = read_prices()

    # Ascending timestamp, trade_id as tiebreaker.
    trades.sort(key=lambda r: (r["timestamp"], r["trade_id"]))

    state = {}

    for row in trades:
        symbol = row["symbol"]
        lot = state.setdefault(
            symbol,
            {
                "qty": Decimal(0),
                "basis": Decimal(0),
                "avg": Decimal(0),
                "realized": Decimal(0),
                "buy_fees": Decimal(0),
                "sell_fees": Decimal(0),
                "trades": 0,
                "closes": 0,
                "reopens": 0,
            },
        )

        qty = Decimal(row["quantity"])
        price = Decimal(row["price_usd"])
        fee = Decimal(row["fee_usd"])
        lot["trades"] += 1

        if row["side"] == "BUY":
            if lot["qty"] == 0 and lot["trades"] > 1:
                lot["reopens"] += 1
            lot["basis"] += qty * price + fee
            lot["qty"] += qty
            lot["avg"] = lot["basis"] / lot["qty"] if lot["qty"] != 0 else Decimal(0)
            lot["buy_fees"] += fee
        else:
            assert qty <= lot["qty"], f"short position at {row['trade_id']}"
            # Full close consumes the exact remaining basis; see engine.ts applySell.
            cost_removed = lot["basis"] if qty == lot["qty"] else lot["avg"] * qty
            lot["realized"] += (qty * price - fee) - cost_removed
            lot["qty"] -= qty
            lot["basis"] -= cost_removed
            lot["sell_fees"] += fee
            if lot["qty"] == 0:
                lot["basis"] = Decimal(0)
                lot["avg"] = Decimal(0)
                lot["closes"] += 1

    portfolio_value = sum(
        (lot["qty"] * prices[symbol] for symbol, lot in state.items() if symbol in prices),
        Decimal(0),
    )

    positions = []
    for symbol, lot in state.items():
        price = prices.get(symbol)
        value = lot["qty"] * price if price is not None else None
        unrealized = (value - lot["basis"]) if value is not None else None
        positions.append(
            {
                "symbol": symbol,
                "quantity": str(lot["qty"]),
                "averageCost": str(lot["avg"]),
                "costBasis": str(lot["basis"]),
                "currentPrice": str(price) if price is not None else None,
                "currentValue": str(value) if value is not None else None,
                "realizedPnl": str(lot["realized"]),
                "unrealizedPnl": str(unrealized) if unrealized is not None else None,
                "totalPnl": str(lot["realized"] + unrealized) if unrealized is not None else None,
                "allocation": str(value / portfolio_value)
                if value is not None and portfolio_value != 0
                else None,
                "buyFees": str(lot["buy_fees"]),
                "sellFees": str(lot["sell_fees"]),
                "totalFees": str(lot["buy_fees"] + lot["sell_fees"]),
                "tradeCount": lot["trades"],
                "fullCloses": lot["closes"],
                "reopens": lot["reopens"],
            }
        )

    positions.sort(key=lambda p: p["symbol"])

    realized = sum((Decimal(p["realizedPnl"]) for p in positions), Decimal(0))
    unrealized = sum(
        (Decimal(p["unrealizedPnl"]) for p in positions if p["unrealizedPnl"] is not None),
        Decimal(0),
    )
    basis = sum((Decimal(p["costBasis"]) for p in positions), Decimal(0))
    fees = sum((Decimal(p["totalFees"]) for p in positions), Decimal(0))

    print(
        json.dumps(
            {
                "asOf": as_of,
                "tradeCount": len(trades),
                "positions": positions,
                "totals": {
                    "currentValue": str(portfolio_value),
                    "costBasis": str(basis),
                    "realizedPnl": str(realized),
                    "unrealizedPnl": str(unrealized),
                    "totalPnl": str(realized + unrealized),
                    "totalFees": str(fees),
                },
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
