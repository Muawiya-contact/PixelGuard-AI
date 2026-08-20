"""Fetch a remote image on the caller's behalf.

This endpoint takes a URL from an unauthenticated caller and makes the server
request it, which is textbook SSRF territory: without guards it becomes a proxy
for probing the host's own network, cloud metadata endpoints (169.254.169.254),
and anything else reachable from the container but not from the internet.

Every hop is therefore resolved and checked against private address space
before a connection is made, redirects are followed manually so a public URL
cannot bounce to an internal one, and the response is size-capped while
streaming rather than after.
"""

import ipaddress
import socket
from urllib.parse import urlparse

import httpx

MAX_BYTES = 15 * 1024 * 1024
TIMEOUT_SECONDS = 15.0
MAX_REDIRECTS = 3

# A browser-ish UA: some CDNs refuse default client strings outright.
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; PixelGuard/1.0; +https://github.com/Muawiya-contact/PixelGuard-AI)",
    "Accept": "image/*,*/*;q=0.8",
}


class FetchError(Exception):
    """Raised with a caller-safe message."""


def _assert_public_host(hostname: str) -> None:
    """Resolve a hostname and refuse anything that is not a public address."""
    if not hostname:
        raise FetchError("URL has no host.")
    try:
        infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        raise FetchError(f"Could not resolve host: {hostname}")

    for info in infos:
        addr = info[4][0]
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            continue
        # Covers loopback, RFC1918, link-local (including 169.254.169.254),
        # multicast, reserved and unspecified ranges in one check.
        if not ip.is_global:
            raise FetchError(
                "Refusing to fetch a non-public address. Only public URLs are allowed."
            )


def _validate(url: str) -> str:
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https"):
        raise FetchError("Only http and https URLs are supported.")
    _assert_public_host(parsed.hostname or "")
    return url.strip()


def fetch_image(url: str) -> tuple[bytes, str, str]:
    """Return (bytes, content_type, final_url) for a public image URL."""
    current = _validate(url)

    with httpx.Client(
        timeout=TIMEOUT_SECONDS,
        follow_redirects=False,  # each hop is re-validated by hand
        headers=_HEADERS,
    ) as client:
        for _ in range(MAX_REDIRECTS + 1):
            try:
                with client.stream("GET", current) as response:
                    if response.is_redirect:
                        location = response.headers.get("location")
                        if not location:
                            raise FetchError("Redirect without a destination.")
                        current = _validate(str(response.url.join(location)))
                        continue

                    if response.status_code >= 400:
                        raise FetchError(
                            f"Source returned HTTP {response.status_code}."
                        )

                    content_type = (response.headers.get("content-type") or "").split(";")[0].strip()

                    declared = response.headers.get("content-length")
                    if declared and int(declared) > MAX_BYTES:
                        raise FetchError(
                            f"Image is {int(declared) // 1024} KB; limit is {MAX_BYTES // 1024} KB."
                        )

                    chunks, total = [], 0
                    for chunk in response.iter_bytes():
                        total += len(chunk)
                        # Capped while streaming: a server that lies about
                        # content-length cannot make us buffer the whole body.
                        if total > MAX_BYTES:
                            raise FetchError(
                                f"Image exceeds the {MAX_BYTES // 1024} KB limit."
                            )
                        chunks.append(chunk)

                    body = b"".join(chunks)
                    if not body:
                        raise FetchError("Source returned an empty response.")
                    if content_type and not content_type.startswith("image/"):
                        raise FetchError(
                            f"URL returned {content_type}, not an image."
                        )
                    return body, content_type or "image/*", current
            except httpx.RequestError as exc:
                raise FetchError(f"Could not reach the URL: {type(exc).__name__}")

    raise FetchError("Too many redirects.")
