"""Pairing, CORS with Chrome's Private Network Access preflight, the Host check and request checks."""

import base64

from conftest import CODE

SITE = "https://shriyamgera.github.io"
CREATE = {"kind": "create", "prompt": "Spacer for an M5 bolt"}


def test_health_needs_no_pairing(bridge):
    with bridge.client() as client:
        response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["claude_found"] is True
    assert body["claude_version"] == "2.1.0"
    assert body["logged_in"] is True
    assert body["tools_found"] is True
    assert body["busy"] is False
    # nothing about the account is passed on
    assert "email" not in response.text and "example.com" not in response.text


def test_run_and_stop_need_the_pairing_code(bridge):
    with bridge.client() as client:
        assert client.post("/run", json=CREATE).status_code == 401
        assert client.post("/stop").status_code == 401
    with bridge.client(**{"X-GKod-Pairing": "WRNG-CODE-2345"}) as client:
        response = client.post("/run", json=CREATE)
        assert response.status_code == 401
        assert response.json()["error"] == "pairing"
    assert bridge.fake.calls() == []


def test_pairing_code_may_be_typed_in_lower_case_without_dashes(bridge):
    typed = CODE.replace("-", " ").lower()
    with bridge.client(**{"X-GKod-Pairing": typed}) as client:
        assert client.post("/stop").json() == {"stopped": False}


def test_allowed_origin_gets_cors_headers(bridge):
    for origin in (SITE, "http://localhost:5173", "http://127.0.0.1:4173"):
        with bridge.client(Origin=origin) as client:
            response = client.get("/health")
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == origin
        assert "Origin" in response.headers["vary"]


def test_other_origins_are_refused(bridge):
    for origin in ("https://evil.example", "http://localhost:3000", "null", "https://shriyamgera.github.io.evil.example"):
        with bridge.client(Origin=origin) as client:
            assert client.get("/health").status_code == 403
            assert client.options("/run", headers={"Access-Control-Request-Method": "POST"}).status_code == 403
            assert client.post("/run", json=CREATE, headers={"X-GKod-Pairing": CODE}).status_code == 403
    assert bridge.fake.calls() == []


def test_preflight_answers_private_network_access(bridge):
    with bridge.client(Origin=SITE) as client:
        response = client.options(
            "/run",
            headers={
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type, x-gkod-pairing",
                "Access-Control-Request-Private-Network": "true",
            },
        )
    assert response.status_code == 204
    assert response.content == b""
    assert response.headers["access-control-allow-origin"] == SITE
    assert response.headers["access-control-allow-private-network"] == "true"
    assert "x-gkod-pairing" in response.headers["access-control-allow-headers"]
    assert "POST" in response.headers["access-control-allow-methods"]


def test_preflight_without_private_network_request_leaves_that_header_out(bridge):
    with bridge.client(Origin="http://localhost:4173") as client:
        response = client.options("/health", headers={"Access-Control-Request-Method": "GET"})
    assert response.status_code == 204
    assert "access-control-allow-private-network" not in response.headers


def test_a_rebound_host_name_is_refused(bridge):
    with bridge.client(Host="evil.example:8765") as client:
        assert client.get("/health").status_code == 403


def test_bad_requests_get_plain_messages(bridge):
    png = b"\x89PNG\r\n\x1a\n" + b"\0" * 64
    bad = [
        ({"kind": "create", "prompt": "  "}, 400),
        ({"kind": "edit", "instruction": "wider"}, 400),
        ({"kind": "repair", "code": "cube(1);"}, 400),
        ({"kind": "explode"}, 400),
        ({**CREATE, "model": "model-9; rm -rf"}, 400),
        ({**CREATE, "session_id": "../../etc"}, 400),
        ({**CREATE, "extra": 1}, 400),
        ({**CREATE, "image": "not base64!"}, 400),
        ({**CREATE, "image": base64.b64encode(b"GIF89a....").decode()}, 400),
        ({"kind": "edit", "instruction": "wider", "code": "cube(1);", "image": base64.b64encode(png).decode()}, 400),
        ({**CREATE, "image": base64.b64encode(png + b"\0" * (4 * 1024 * 1024)).decode()}, 413),
    ]
    with bridge.client(**{"X-GKod-Pairing": CODE}) as client:
        for body, status in bad:
            response = client.post("/run", json=body)
            assert response.status_code == status, body
            assert response.json()["message"]
    assert bridge.fake.calls() == []


def test_a_body_over_8_mb_is_refused_before_it_is_read(bridge):
    with bridge.client(**{"X-GKod-Pairing": CODE}) as client:
        response = client.post("/run", content=b"x" * (8 * 1024 * 1024 + 1), headers={"content-type": "application/json"})
    assert response.status_code == 413


def test_a_chunked_body_over_8_mb_is_refused_while_it_is_read(bridge):
    # no Content-Length: the body comes in chunks, so only counting the bytes can stop it
    sent = 0

    def chunks():
        nonlocal sent
        piece = b" " * (256 * 1024)
        while sent < 40 * 1024 * 1024:
            sent += len(piece)
            yield piece

    with bridge.client(**{"X-GKod-Pairing": CODE}) as client:
        response = client.post("/run", content=chunks(), headers={"content-type": "application/json"})
    assert response.status_code == 413
    assert response.json()["error"] == "too-big"
    assert sent < 40 * 1024 * 1024
    assert bridge.fake.calls() == []


def test_a_small_chunked_body_still_runs(bridge):
    import json

    def chunks():
        text = json.dumps(CREATE).encode()
        yield text[:10]
        yield text[10:]

    with bridge.client(**{"X-GKod-Pairing": CODE}) as client:
        with client.stream("POST", "/run", content=chunks(), headers={"content-type": "application/json"}) as response:
            assert response.status_code == 200
            assert "event: final" in response.read().decode()
    assert len(bridge.fake.calls()) == 1


def test_length_limits_fit_what_the_site_sends(bridge):
    longest = "w" * 4000
    with bridge.client(**{"X-GKod-Pairing": CODE}) as client:
        over = client.post("/run", json={"kind": "create", "prompt": longest + "w"})
        assert over.status_code == 400
        assert over.json()["message"] == "The prompt is too long for Claude Code: at most 4000 characters."
    # the repair after a failed compile of the longest change sends "change the part: " and the change
    repair = {"kind": "repair", "code": "cube(1);", "error": "Line 1: syntax error", "request": f"change the part: {longest}"}
    with bridge.client(**{"X-GKod-Pairing": CODE}) as client, client.stream("POST", "/run", json=repair) as response:
        assert response.status_code == 200
        assert "event: final" in response.read().decode()

