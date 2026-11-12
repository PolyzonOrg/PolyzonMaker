"""ballast.py's reading of memory pressure: python -m pytest -q test_ballast.py"""

import ballast


def test_pressure_is_read_as_each_system_gives_it():
    assert [ballast.level_of(darwin_level=n) for n in (1, 2, 4)] == [0, 1, 2]
    psi = lambda full: f"some avg10=50.00 avg60=1 avg300=0 total=1\nfull avg10={full} avg60=0 avg300=0 total=2\n"
    assert [ballast.level_of(psi_text=psi(v)) for v in ("1.00", "12.00", "30.00")] == [0, 1, 2]
    assert ballast.level_of() == 0, "nothing known is not pressure"
