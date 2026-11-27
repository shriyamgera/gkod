"""Intervals and paired tests for the benchmark tables. Plain Python, no SciPy."""

from __future__ import annotations

import math
from collections.abc import Sequence

# two-sided 95%
Z95 = 1.959963984540054


def wilson(successes: int, n: int, z: float = Z95) -> tuple[float, float]:
    """The Wilson score interval for a rate. With n = 0 there is nothing to say, so it is (0, 1)."""
    if n <= 0:
        return (0.0, 1.0)
    if not 0 <= successes <= n:
        raise ValueError(f"successes must be between 0 and n, got {successes} of {n}")
    p = successes / n
    z2 = z * z
    centre = (p + z2 / (2 * n)) / (1 + z2 / n)
    half = z * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / (1 + z2 / n)
    # at 0 or n the bound is exactly the edge; rounding must not push it past
    low = 0.0 if successes == 0 else max(0.0, centre - half)
    high = 1.0 if successes == n else min(1.0, centre + half)
    return (low, high)


def rate(successes: int, n: int) -> dict:
    """A rate with its 95% Wilson interval, as the summaries write it."""
    low, high = wilson(successes, n)
    return {"n": n, "k": successes, "rate": successes / n if n else None, "ci95": [low, high]}


def _beta_fraction(a: float, b: float, x: float) -> float:
    """The continued fraction of the incomplete beta function (modified Lentz)."""
    tiny = 1e-300
    c, d = 1.0, 1.0 - (a + b) * x / (a + 1)
    d = 1.0 / (d if abs(d) > tiny else tiny)
    out = d
    for m in range(1, 500):
        for num in (m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m)), -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1))):
            d = 1.0 + num * d
            d = 1.0 / (d if abs(d) > tiny else tiny)
            c = 1.0 + num / c
            c = c if abs(c) > tiny else tiny
            out *= c * d
        if abs(c * d - 1.0) < 1e-15:
            break
    return out


def beta_reg(a: float, b: float, x: float) -> float:
    """The regularized incomplete beta function I_x(a, b)."""
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    front = math.exp(math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log1p(-x))
    if x < (a + 1) / (a + b + 2):
        return front * _beta_fraction(a, b, x) / a
    return 1.0 - front * _beta_fraction(b, a, 1.0 - x) / b


def t95(df: int) -> float:
    """The two-sided 95% quantile of Student's t with `df` degrees of freedom (2.131 for 15), found by bisection on
    P(|T| > t) = I_{df / (df + t^2)}(df / 2, 1 / 2) = 0.05."""
    if df < 1:
        raise ValueError("Student's t needs at least 1 degree of freedom")
    low, high = 0.0, 1000.0
    for _ in range(200):
        mid = (low + high) / 2
        if beta_reg(df / 2, 0.5, df / (df + mid * mid)) > 0.05:
            low = mid
        else:
            high = mid
    return (low + high) / 2


def mean_ci(values: Sequence[float]) -> dict:
    """A mean with a 95% interval from Student's t on n - 1 degrees of freedom (sample standard deviation). With about
    16 prompts in a tier 3 family, the normal z would make it about 8% too narrow."""
    n = len(values)
    if n == 0:
        return {"n": 0, "mean": None, "ci95": None}
    mean = sum(values) / n
    if n == 1:
        return {"n": 1, "mean": mean, "ci95": None}
    var = sum((v - mean) ** 2 for v in values) / (n - 1)
    half = t95(n - 1) * math.sqrt(var / n)
    return {"n": n, "mean": mean, "ci95": [mean - half, mean + half]}


def median(values: Sequence[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    mid = len(ordered) // 2
    return ordered[mid] if len(ordered) % 2 else (ordered[mid - 1] + ordered[mid]) / 2


def binom_two_sided(k: int, n: int) -> float:
    """Exact two-sided p for k or fewer of n at p = 0.5 (doubled, capped at 1): the exact McNemar test."""
    if n == 0:
        return 1.0
    k = min(k, n - k)
    tail = sum(math.comb(n, i) for i in range(k + 1)) / 2**n
    return min(1.0, 2 * tail)


def paired_rates(a: Sequence[bool], b: Sequence[bool], z: float = Z95) -> dict:
    """Two rows on the same prompts: each rate, the difference A - B with Newcombe's interval for paired
    proportions (method 10, no continuity correction), and the exact McNemar p on the discordant pairs."""
    if len(a) != len(b):
        raise ValueError("paired rates need the same prompts on both sides")
    n = len(a)
    both = sum(1 for x, y in zip(a, b) if x and y)
    only_a = sum(1 for x, y in zip(a, b) if x and not y)
    only_b = sum(1 for x, y in zip(a, b) if y and not x)
    neither = n - both - only_a - only_b
    out = {"n": n, "both": both, "only_a": only_a, "only_b": only_b, "neither": neither}
    if n == 0:
        return {**out, "rate_a": None, "rate_b": None, "diff": None, "ci95": None, "mcnemar_p": 1.0}
    p1, p2 = (both + only_a) / n, (both + only_b) / n
    l1, u1 = wilson(both + only_a, n, z)
    l2, u2 = wilson(both + only_b, n, z)
    denom = (both + only_a) * (only_b + neither) * (both + only_b) * (only_a + neither)
    phi = (both * neither - only_a * only_b) / math.sqrt(denom) if denom > 0 else 0.0
    diff = p1 - p2
    low = diff - math.sqrt(max(0.0, (p1 - l1) ** 2 - 2 * phi * (p1 - l1) * (u2 - p2) + (u2 - p2) ** 2))
    high = diff + math.sqrt(max(0.0, (u1 - p1) ** 2 - 2 * phi * (u1 - p1) * (p2 - l2) + (p2 - l2) ** 2))
    return {
        **out,
        "rate_a": p1,
        "rate_b": p2,
        "diff": diff,
        "ci95": [max(-1.0, low), min(1.0, high)],
        "mcnemar_p": binom_two_sided(min(only_a, only_b), only_a + only_b),
    }


def paired_means(a: Sequence[float], b: Sequence[float]) -> dict:
    """Mean of A - B on the same prompts with a Student t 95% interval, and the exact sign test p (ties dropped)."""
    if len(a) != len(b):
        raise ValueError("paired means need the same prompts on both sides")
    diffs = [x - y for x, y in zip(a, b)]
    stats = mean_ci(diffs)
    wins = sum(1 for d in diffs if d > 0)
    losses = sum(1 for d in diffs if d < 0)
    return {
        "n": len(diffs),
        "mean_a": sum(a) / len(a) if a else None,
        "mean_b": sum(b) / len(b) if b else None,
        "diff": stats["mean"],
        "ci95": stats["ci95"],
        "a_higher": wins,
        "b_higher": losses,
        "sign_p": binom_two_sided(min(wins, losses), wins + losses),
    }
