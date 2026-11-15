# PATRIOT-AD — Web Command Dashboard (`web/`)

Frontend dashboard komando untuk platform pengawasan siber-fisik **PATRIOT-AD** (*Next.js 16 + React 19 + TypeScript + Tailwind CSS 4 + Three.js*).

Panduan instalasi lengkap, demo penjurian, dan integrasi hardware tersedia pada [README utama](../README.md).

## Menjalankan Frontend

```bash
npm install
npm run dev
```

Akses melalui `http://localhost:3000`.

- **Mode Live Terintegrasi**: Jika backend FastAPI aktif pada port `8000`, dashboard otomatis terhubung ke REST API & WebSocket (`ws://<host>:8000/ws`).
- **Mode Simulasi Mandiri**: Jika backend tidak dijalankan atau aplikasi diakses melalui HTTPS (mis. deployment Vercel), dashboard otomatis memakai mesin simulasi lokal di browser untuk menampilkan skenario `SCN-01` s.d. `SCN-05`.

## Verifikasi Kode

```bash
npm run lint
npx tsc --noEmit
npm run build
```
