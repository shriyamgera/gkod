import pytest


@pytest.fixture(autouse=True)
def out_folder(tmp_path, monkeypatch):
    """Every test writes its parts and pictures to its own folder, not the repo's .gkod-out."""
    folder = tmp_path / "out"
    monkeypatch.setenv("GKOD_OUT", str(folder))
    return folder


@pytest.fixture
def anyio_backend():
    return "asyncio"
