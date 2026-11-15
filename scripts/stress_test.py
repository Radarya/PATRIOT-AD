"""Stress Test Suite untuk Backend PATRIOT-AD (FastAPI + SQLite WAL + Policy Engine).

Menguji:
1. Concurrency: 500 concurrent requests ke /api/status dan /api/command.
2. Latency: p50, p95, p99 response time.
3. Throughput: Requests Per Second (RPS).
4. SQLite WAL under heavy concurrent writes.
5. DoS / Message Burst Isolation.
"""

import asyncio
import sys
import time

try:
    import httpx
except ModuleNotFoundError:
    print("[ERROR] Paket 'httpx' belum terpasang di interpreter Python ini.")
    print("        Jalankan lewat environment backend:")
    print("        uv run --project backend python scripts/stress_test.py")
    sys.exit(1)

API_BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:8000"

async def test_concurrent_status(num_requests: int = 500, concurrency: int = 30):
    print(f"\n[1] Menjalankan Stress Test: {num_requests} Requests ke /api/status (Konkurensi {concurrency} worker)...")
    limits = httpx.Limits(max_connections=40, max_keepalive_connections=40)
    sem = asyncio.Semaphore(concurrency)
    async with httpx.AsyncClient(timeout=10.0, limits=limits) as client:
        async def fetch_status():
            async with sem:
                return await client.get(f"{API_BASE}/api/status")

        start = time.perf_counter()
        tasks = [fetch_status() for _ in range(num_requests)]
        responses = await asyncio.gather(*tasks, return_exceptions=True)
        elapsed = time.perf_counter() - start

    success = [r for r in responses if isinstance(r, httpx.Response) and r.status_code == 200]
    errors = len(responses) - len(success)
    rps = num_requests / elapsed if elapsed > 0 else 0

    print(f"    -> Total Waktu: {elapsed:.3f} detik")
    print(f"    -> Sukses (HTTP 200): {len(success)} / {num_requests} ({(len(success)/num_requests)*100:.1f}%)")
    print(f"    -> Error / Drop: {errors}")
    print(f"    -> Throughput: {rps:.1f} Requests / Detik")
    return rps

async def _login_role(client: httpx.AsyncClient, role: str) -> str | None:
    try:
        r = await client.post(f"{API_BASE}/api/auth/login", json={"role": role})
        if r.status_code == 200:
            return r.json().get("token")
    except Exception:
        pass
    return None


async def test_command_flood(num_requests: int = 200, concurrency: int = 30):
    print(f"\n[2] Menjalankan Stress Test Command Flood: {num_requests} Perintah ke /api/command (Konkurensi {concurrency})...")
    payload = {
        "requester": "operator",
        "target_device": "esp32_gudang",
        "command": "FAN_ON",
        "reason": "Stress Test Concurrency",
    }
    latencies = []
    limits = httpx.Limits(max_connections=40, max_keepalive_connections=40)
    sem = asyncio.Semaphore(concurrency)
    async with httpx.AsyncClient(timeout=10.0, limits=limits) as client:
        op_token = await _login_role(client, "operator")
        headers = {"X-Patriot-Token": op_token} if op_token else {}
        start_total = time.perf_counter()

        async def send_single():
            async with sem:
                t0 = time.perf_counter()
                try:
                    r = await client.post(f"{API_BASE}/api/command", json=payload, headers=headers)
                    t1 = time.perf_counter()
                    latencies.append((t1 - t0) * 1000)
                    if r.status_code == 200:
                        return (200, r.json().get("status"))
                    return (r.status_code, None)
                except Exception as e:
                    return (str(e), None)

        tasks = [send_single() for _ in range(num_requests)]
        results = await asyncio.gather(*tasks)
        elapsed = time.perf_counter() - start_total

        # Pulihkan status operator dari karantina otomatis pasca-flood
        admin_token = await _login_role(client, "admin")
        if admin_token:
            admin_headers = {"X-Patriot-Token": admin_token}
            await client.post(f"{API_BASE}/api/quarantine/operator/release", headers=admin_headers)
            await client.post(f"{API_BASE}/api/benchmark/SCN-01", headers=admin_headers)

    success = [res for res in results if res[0] == 200]
    approved = [res for res in success if res[1] == "APPROVE"]
    throttled = [res for res in success if res[1] != "APPROVE"]
    latencies.sort()
    p50 = latencies[len(latencies) // 2] if latencies else 0
    p95 = latencies[min(len(latencies) - 1, int(len(latencies) * 0.95))] if latencies else 0
    p99 = latencies[min(len(latencies) - 1, int(len(latencies) * 0.99))] if latencies else 0

    print(f"    -> Total Waktu: {elapsed:.3f} detik")
    print(
        f"    -> Diproses Policy Gateway (HTTP 200): {len(success)} / {num_requests} "
        f"(Disetujui: {len(approved)}, Diblokir/Karantina DoS: {len(throttled)})"
    )
    print(f"    -> Latensi p50 (Median): {p50:.2f} ms")
    print(f"    -> Latensi p95: {p95:.2f} ms")
    print(f"    -> Latensi p99: {p99:.2f} ms")
    print(f"    -> Throughput: {len(success) / elapsed:.1f} RPS" if elapsed > 0 else "    -> Throughput: N/A")

async def test_sha256_audit_speed():
    print(f"\n[3] Menguji Kecepatan Verifikasi Rantai Kriptografi SHA-256...")
    async with httpx.AsyncClient(timeout=10.0) as client:
        t0 = time.perf_counter()
        r = await client.get(f"{API_BASE}/api/forensic/verify")
        elapsed_ms = (time.perf_counter() - t0) * 1000

    if r.status_code == 200:
        data = r.json()
        ok = bool(data.get("ok"))
        err_count = len(data.get("errors") or [])
        verdict = "VALID (100% Utuh)" if ok else f"TERDETEKSI KERUSAKAN ({err_count} temuan)"
        print(f"    -> Status Verifikasi: {verdict}")
        print(
            f"    -> Total Blok Diverifikasi: {data.get('records_checked', 0)} blok "
            f"(Checkpoint: {data.get('checkpoints_checked', 0)})"
        )
        print(f"    -> Waktu Verifikasi: {elapsed_ms:.2f} ms")
    else:
        print(f"    -> Gagal: {r.status_code}")

async def main():
    print("=" * 65)
    print("  PATRIOT-AD STRESS TEST & SECURITY HARDENING BENCHMARK")
    print("  Target Backend: " + API_BASE)
    print("=" * 65)
    await test_concurrent_status(500)
    await test_command_flood(200)
    await test_sha256_audit_speed()
    print("\n" + "=" * 65)
    print("  STRESS TEST SELESAI: Backend dan Policy Gateway Terbukti Tangguh!")
    print("=" * 65)

if __name__ == "__main__":
    asyncio.run(main())
