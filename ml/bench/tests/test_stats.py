import math

import pytest

from gkod_bench.stats import binom_two_sided, mean_ci, median, paired_means, paired_rates, rate, t95, wilson


def close(a, b, tol=1e-4):
    return all(math.isclose(x, y, abs_tol=tol) for x, y in zip(a, b))


def test_wilson_known_values():
    # standard textbook values
    assert close(wilson(8, 10), (0.4902, 0.9433))
    assert close(wilson(50, 100), (0.4038, 0.5962))
    assert close(wilson(95, 100), (0.8882, 0.9785))


def test_wilson_edges():
    low, high = wilson(0, 10)
    assert low == 0.0 and close([high], [0.2775])
    low, high = wilson(10, 10)
    assert high == 1.0 and close([low], [0.7225])
    assert wilson(0, 0) == (0.0, 1.0)
    with pytest.raises(ValueError):
        wilson(11, 10)


def test_rate_record():
    r = rate(3, 4)
    assert r["n"] == 4 and r["k"] == 3 and r["rate"] == 0.75
    assert r["ci95"][0] < 0.75 < r["ci95"][1]
    assert rate(0, 0)["rate"] is None


def test_student_t_quantiles():
    # closed forms for 1 and 2 degrees of freedom, and published table values
    assert math.isclose(t95(1), math.tan(0.475 * math.pi), abs_tol=1e-6)
    assert math.isclose(t95(2), 0.95 / math.sqrt(2 * 0.975 * 0.025), abs_tol=1e-6)
    for df, value in ((3, 3.182446), (10, 2.228139), (15, 2.131450), (30, 2.042272), (60, 2.000298), (120, 1.979930), (1000, 1.962339)):
        assert math.isclose(t95(df), value, abs_tol=1e-6), df
    with pytest.raises(ValueError):
        t95(0)


def test_mean_and_median():
    m = mean_ci([1.0, 2.0, 3.0, 4.0])
    assert m["mean"] == 2.5
    # Student's t on 3 degrees of freedom, not the normal 1.96
    half = 3.182446 * math.sqrt((2.25 + 0.25 + 0.25 + 2.25) / 3 / 4)
    assert close(m["ci95"], [2.5 - half, 2.5 + half])
    # 16 prompts, as in one tier 3 family of the test split: t on 15 degrees of freedom
    values = [0.1 * (i % 7) for i in range(16)]
    mean = sum(values) / 16
    sd = math.sqrt(sum((v - mean) ** 2 for v in values) / 15)
    assert close(mean_ci(values)["ci95"], [mean - 2.131450 * sd / 4, mean + 2.131450 * sd / 4], 1e-6)
    assert mean_ci([])["mean"] is None
    assert mean_ci([0.5])["ci95"] is None
    assert median([3, 1, 2]) == 2 and median([4, 1, 2, 3]) == 2.5 and median([]) is None


def test_exact_binomial():
    assert binom_two_sided(0, 0) == 1.0
    assert math.isclose(binom_two_sided(0, 5), 2 / 32)
    assert math.isclose(binom_two_sided(1, 10), 2 * 11 / 1024)
    assert binom_two_sided(5, 10) == 1.0
    # symmetric in k and n - k
    assert binom_two_sided(8, 10) == binom_two_sided(2, 10)


def test_paired_rates_counts_and_interval():
    a = [True] * 30 + [True] * 10 + [False] * 3 + [False] * 7
    b = [True] * 30 + [False] * 10 + [True] * 3 + [False] * 7
    r = paired_rates(a, b)
    assert (r["both"], r["only_a"], r["only_b"], r["neither"]) == (30, 10, 3, 7)
    assert math.isclose(r["diff"], 7 / 50)
    low, high = r["ci95"]
    assert -1 <= low < r["diff"] < high <= 1
    assert math.isclose(r["mcnemar_p"], binom_two_sided(3, 13))
    # swapping the rows negates the difference and mirrors the interval
    s = paired_rates(b, a)
    assert math.isclose(s["diff"], -r["diff"])
    assert close(s["ci95"], [-high, -low], 1e-9)


def test_paired_rates_identical_rows():
    a = [True, False, True, True]
    r = paired_rates(a, a)
    assert r["diff"] == 0 and r["mcnemar_p"] == 1.0
    assert r["ci95"][0] <= 0 <= r["ci95"][1]
    with pytest.raises(ValueError):
        paired_rates([True], [True, False])
    assert paired_rates([], [])["diff"] is None


def test_paired_means():
    r = paired_means([0.9, 0.8, 0.7, 0.5], [0.5, 0.8, 0.6, 0.6])
    assert math.isclose(r["diff"], (0.4 + 0 + 0.1 - 0.1) / 4)
    assert r["a_higher"] == 2 and r["b_higher"] == 1
    assert math.isclose(r["sign_p"], 1.0)
