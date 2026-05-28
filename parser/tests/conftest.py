import os
import pytest

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")


@pytest.fixture
def fixtures_dir():
    os.makedirs(FIXTURES_DIR, exist_ok=True)
    return FIXTURES_DIR


def get_fixture_path(filename: str) -> str:
    return os.path.join(FIXTURES_DIR, filename)
