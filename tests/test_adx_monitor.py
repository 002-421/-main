from adx_monitor.calculator import Candle, calculate_adx


def _candles() -> list[Candle]:
    closes = [
        100, 101, 102, 103, 104, 105, 106, 107, 108, 109,
        110, 111, 112, 113, 114, 113, 112, 111, 110, 109,
        108, 107, 106, 105, 104, 103, 102, 101, 100, 99,
        98, 97, 96, 95, 94, 93, 92, 91, 90, 89,
    ]
    return [Candle(f"t{i}", close + 0.5, close - 0.5, close) for i, close in enumerate(closes)]


def test_calculate_adx_returns_values_after_warmup() -> None:
    points = calculate_adx(_candles(), period=5, threshold=20)

    assert len(points) == 40
    assert points[9].adx is not None
    assert all(point.adx is not None for point in points[9:])


def test_calculate_adx_emits_sell_on_di_cross_above_threshold() -> None:
    points = calculate_adx(_candles(), period=5, threshold=20)

    assert "SELL" in {point.signal for point in points}


def test_calculate_adx_rejects_too_small_period() -> None:
    try:
        calculate_adx(_candles(), period=1)
    except ValueError as exc:
        assert "at least 2" in str(exc)
    else:
        raise AssertionError("period=1 must fail")
