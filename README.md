# fi-drive
## Lisensi
Kode proyek ini menggunakan [MIT License](LICENSE), dengan atribusi kepada kontributor fi-drive, termasuk kontributor proyek kelompok asal. Dependency pihak ketiga tetap menggunakan lisensinya masing-masing; lisensi MIT proyek ini tidak menggantikan lisensi atau pemberitahuan hak cipta dependency.

Drive pribadi dengan beberapa akun owner yang mengakses drive yang sama. Seluruh aplikasi berjalan di Cloudflare: satu Worker melayani frontend React (Workers Static Assets) dan API `/api/*`, metadata disimpan di D1, isi berkas di bucket R2 privat, dan login dijaga Cloudflare Access dengan IdP Microsoft Entra ID.

## Fitur
- Login Microsoft Entra ID melalui Cloudflare Access.
- Hanya akun dengan email dalam `OWNER_EMAILS` yang dapat memakai API privat. Akun lain ditolak (403).
- Kuota total drive 100 MiB (104.857.600 byte), tanpa pembagian kuota per pengguna. Semua tipe berkas diterima, termasuk Markdown, dengan batas 10 MiB per berkas.
- Upload, download, hapus berkas, dan public link, tanpa Manage Members atau berbagi antaranggota.
- Public link dibatasi 50 unduhan per berkas, ditegakkan dengan `UPDATE` atomik di D1. Link lama (10 unduhan) disesuaikan saat dipakai, dengan unduhan yang sudah terpakai tetap dihitung.

Objek R2 tetap privat; unduhan publik melewati Worker tanpa login. `OWNER_EMAILS` berisi daftar email owner dipisahkan koma. `OWNER_EMAIL` adalah identitas partisi penyimpanan (kolom `owner_email` dan baris `users`); jangan mengubahnya untuk menambah atau menghapus akses akun. Jika `OWNER_EMAILS` belum diatur, akses memakai `OWNER_EMAIL`.

## Arsitektur
| Bagian | Lokasi | Catatan |
|---|---|---|
| Worker | `worker/src/index.js` | router `/api/*`, path lain diteruskan ke `env.ASSETS` (SPA fallback, termasuk `/s/<token>`) |
| Auth | `worker/src/auth.js` | verifikasi JWT `Cf-Access-Jwt-Assertion` (cadangan cookie `CF_Authorization`): RS256 terhadap JWKS `https://<ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs` (cache 1 jam), cek `aud`, `iss`, `exp` |
| D1 `fi-drive-db` | `migrations/` | tabel `users`, `files`, `public_links` |
| R2 `fi-drive-files` | binding `FILES` | key objek = id berkas (UUID) |
| Konfigurasi | `wrangler.jsonc` | `keep_vars: true`, variabel diatur di dashboard |

Variabel Worker (bukan rahasia, tetapi jangan di-commit nilai produksinya): `OWNER_EMAIL`, `OWNER_EMAILS`, `ACCESS_TEAM_DOMAIN` (host penuh, mis. `tim.cloudflareaccess.com`), `ACCESS_AUD` (AUD tag aplikasi Access). Nilai kosong berarti semua akses ditolak. `/api/public/*` tidak memerlukan login.

## Menjalankan secara lokal
Prasyarat: Node.js 22.12+.
```powershell
npm ci
Copy-Item .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```
Buka `http://127.0.0.1:8787`. `DEV_AUTH_USER` di `.dev.vars` menggantikan login Access, tetapi hanya untuk host `localhost`/`127.0.0.1` (`wrangler dev`); di domain lain variabel itu diabaikan. Jangan pernah mengaturnya di dashboard. D1 dan R2 lokal tersimpan di `.wrangler/` (gitignored).

## Pemeriksaan
```powershell
npm test                                  # verifikasi JWT Access, logika owner, halaman public link
node scripts/test-migrate-sql.mjs         # konversi Cosmos -> SQL
npm run test:e2e                          # butuh `npm run dev` berjalan: upload, list, download, public link 50x, delete
cd web; npm run lint; npm run build
```
Untuk link uji pada deployment yang berjalan: `node scripts/test-public-link.mjs <URL-download>` (menghabiskan jatah unduh link uji).

## Cloudflare MCP dan Wrangler
Wrangler dipasang sebagai devDependency terkunci (`npx wrangler --version`). Login: `npx wrangler login`, cek dengan `npx wrangler whoami`. Untuk asisten AI, tambahkan server MCP resmi Cloudflare di konfigurasi klien MCP Anda (bukan di repo), misalnya `https://bindings.mcp.cloudflare.com/mcp` (D1, R2, Workers) dan `https://docs.mcp.cloudflare.com/mcp` (dokumentasi).

## Deploy
Resource sudah dibuat sekali: D1 `fi-drive-db` (id ada di `wrangler.jsonc`) dan bucket R2 `fi-drive-files`. Untuk akun baru: `npx wrangler d1 create fi-drive-db` (salin id ke `wrangler.jsonc`) dan `npx wrangler r2 bucket create fi-drive-files`.
```powershell
npm run db:migrate:remote
npm run deploy        # menjalankan build web (build.command) lalu deploy
```
CI/CD utama: Workers Builds. Di dashboard Worker `fi-drive`, Settings > Builds, hubungkan repo GitHub, branch `main`, root directory `/`, build command `npm ci`, deploy command `npx wrangler deploy` (build web dijalankan oleh `build.command` di `wrangler.jsonc`). Workflow `.github/workflows/deploy.yml` adalah cadangan manual (`workflow_dispatch`) dan membutuhkan secret `CLOUDFLARE_API_TOKEN` dan `CLOUDFLARE_ACCOUNT_ID`. Migrasi D1 baru dijalankan manual dengan `npm run db:migrate:remote` sebelum deploy yang membutuhkannya.

## Cutover manual
Langkah berikut sengaja tidak diotomatisasi:
1. Atur variabel Worker `OWNER_EMAIL` (pertahankan email partisi lama), `OWNER_EMAILS`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` di dashboard.
2. Zero Trust > Settings > Authentication: tambahkan Microsoft Entra ID sebagai login method.
3. Zero Trust > Access > Applications: buat aplikasi self-hosted untuk `drive.alfi.ai.id` dengan policy Allow untuk email owner dan IdP Entra ID. Salin AUD tag ke `ACCESS_AUD`.
4. Buat aplikasi/policy Bypass (Everyone) untuk path anonim: `drive.alfi.ai.id/api/public/*`, `drive.alfi.ai.id/s/*`, `drive.alfi.ai.id/assets/*`, `drive.alfi.ai.id/favicon.svg`. Halaman `/s/<token>` adalah SPA, sehingga `index.html` dan `/assets/*` (hasil build Vite) harus bisa dimuat tanpa login. Link lama `/?public=<token>` berada di bawah `/` sehingga memerlukan login setelah cutover kecuali Anda menambah bypass yang sesuai.
5. Bekukan upload di Azure, jalankan `npm i --no-save @azure/cosmos @azure/storage-blob`, lalu `node scripts/migrate-azure-to-cf.mjs --out tmp/migration` (dry run, mencetak perintah) dan setelah dicek `--apply --i-understand-this-touches-production`. Bandingkan jumlah baris dan `users.used_bytes` dengan Cosmos. Hapus `tmp/migration` sesudahnya.
6. Pasang custom domain `drive.alfi.ai.id` ke Worker (Settings > Domains & Routes). Zona DNS tetap di Cloudflare; hapus dulu CNAME `drive` lama yang mengarah ke Static Web Apps.
7. Uji produksi: login, upload, download, public link anonim, logout (`/cdn-cgi/access/logout`).
8. Hapus resource Azure (Static Web App, Cosmos DB, Storage account, resource group) dan secret GitHub `AZURE_STATIC_WEB_APPS_API_TOKEN`.

## Domain
URL produksi drive: `https://drive.alfi.ai.id/`. Public link baru menggunakan `/s/<token>`; format lama `/?public=<token>` tetap didukung frontend. Membuka halaman public link tidak menghabiskan jatah unduhan; unduhan dimulai setelah tombol Download diklik.

Cloudflare Worker [`scripts/drive-proxy.mjs`](scripts/drive-proxy.mjs) mengalihkan URL lama `/drive`, `/drive/*`, `/api/*`, dan `/.auth/*` pada domain utama ke subdomain baru dengan status 308. Verifikasi lokal: `node scripts/test-drive-proxy.mjs`.

## Batasan
- Tidak ada pratinjau atau thumbnail otomatis dan pemindaian malware.
- Workers Free membatasi body request 100 MB; aplikasi memakai batas 10 MiB per berkas.
- Bila Access belum dikonfigurasi atau `ACCESS_AUD` salah, API privat membalas 401 dan frontend terus mengarahkan ke `/`.
