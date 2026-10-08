# fi-drive

## Lisensi

Kode proyek ini menggunakan [MIT License](LICENSE), dengan atribusi kepada kontributor fi-drive, termasuk kontributor proyek kelompok asal. Dependency pihak ketiga tetap menggunakan lisensinya masing-masing; lisensi MIT proyek ini tidak menggantikan lisensi atau pemberitahuan hak cipta dependency.

Drive pribadi dengan beberapa akun owner yang mengakses drive yang sama. Frontend React berjalan di Azure Static Web Apps; API terkelola menyimpan metadata di Azure Cosmos DB dan isi berkas di Azure Blob Storage privat.

## Fitur

- Login melalui Microsoft Entra ID bawaan Static Web Apps.
- Hanya akun Microsoft dengan email dalam `OWNER_EMAILS` yang dapat memakai API privat. Akun lain ditolak (403).
- Kuota total drive 100 MiB (104.857.600 byte), tanpa pembagian kuota per pengguna. Semua tipe berkas diterima, termasuk Markdown, dengan batas 10 MiB per berkas.
- Upload, download, hapus berkas, dan public link dengan desain utama yang sama, tanpa Manage Members atau berbagi antaranggota.
- Public link dibatasi 50 unduhan per berkas, ditegakkan API dengan ETag. Link yang dibuat sebelum batas ini berlaku disesuaikan saat dipakai, dengan unduhan yang sudah terpakai tetap dihitung.

Blob tetap privat; unduhan publik melewati API tanpa login. Identitas privat diverifikasi melalui Static Web Apps. Tetapkan `OWNER_EMAILS` sebagai daftar email owner dipisahkan koma. Semua owner bisa melihat, upload, download, menghapus, dan membuat public link pada drive yang sama, dengan kuota total 100 MiB. `OWNER_EMAIL` tetap menjadi identitas partisi penyimpanan; jangan mengubahnya untuk menambah atau menghapus akses akun. Jika `OWNER_EMAILS` belum diatur, akses memakai `OWNER_EMAIL` untuk kompatibilitas.

## Menjalankan secara lokal

Prasyarat: Node.js 22.12+, Docker Desktop, Azure Functions Core Tools v4, dan PowerShell. Perintah berikut dijalankan dari root repo kecuali disebutkan lain.

```powershell
Copy-Item api/local.settings.example.json api/local.settings.json
./scripts/start-emulators.ps1
cd api
npm ci
func start
```

Di terminal lain:

```powershell
cd web
npm ci
npm run build
cd ..
npx @azure/static-web-apps-cli start ./web/dist --api-port 7071 --port 4280
```

Buka `http://localhost:4280/.auth/login/aad` dan login sebagai `admin@example.com`, sesuai contoh `OWNER_EMAIL` di `api/local.settings.json`. Atur `OWNER_EMAILS` dengan akun Microsoft yang diberi akses; `OWNER_EMAIL` menjadi identitas penyimpanan drive. Berkas pengaturan lokal dan nilai rahasia produksi tidak boleh di-commit. Kunci di file contoh adalah kredensial emulator lokal yang dipublikasikan Azure, bukan kunci Azure produksi.

## Pemeriksaan

```powershell
node api/test-personal.js
cd web
npm run lint
npm run build
```

`test-personal.js` menguji akses pemilik, kuota, upload/delete, dan batas 50 unduhan termasuk permintaan paralel dengan penyimpanan dalam memori. Untuk link uji baru pada API yang berjalan: `node scripts/test-public-link.mjs <URL-download>`. Tes tersebut menghabiskan jatah unduh link uji.

## Deploy

Siapkan resource berikut di subscription Azure Anda (nama di bawah hanyalah placeholder):

| Resource | Contoh nama | Catatan |
|---|---|---|
| Resource group | `<your-resource-group>` | wadah semua resource |
| Static Web App | `<your-swa-name>` | paket Free cukup, managed API Node.js 22 |
| Cosmos DB for NoSQL | `<your-cosmos-account>` | database default `fidrive` |
| Storage account | `<your-storage-account>` | container Blob privat, default `files` |

Atur application settings Static Web App berikut (isi nilainya di Azure, bukan di repo):

| Nama | Isi |
|---|---|
| `COSMOS_CONNECTION` | Connection string Cosmos DB |
| `COSMOS_DATABASE` | Nama database, default `fidrive` |
| `STORAGE_CONNECTION` | Connection string Storage account |
| `FILES_CONTAINER` | Nama container Blob, default `files` |
| `OWNER_EMAIL` | Identitas penyimpanan drive, pertahankan email owner lama agar berkas dan kuota tetap tersedia |
| `OWNER_EMAILS` | Email akun Microsoft yang diberi akses, dipisahkan koma |

Contoh dengan Azure CLI:

```powershell
az staticwebapp appsettings set --name <your-swa-name> --resource-group <your-resource-group> --setting-names COSMOS_CONNECTION="<cosmos-connection-string>" COSMOS_DATABASE=fidrive STORAGE_CONNECTION="<storage-connection-string>" FILES_CONTAINER=files OWNER_EMAIL=you@example.com OWNER_EMAILS=you@example.com,second@example.com
```

Cosmos memakai throughput bersama 400 RU/s untuk container `users`, `files`, dan `publicLinks`. Blob ditagih sesuai pemakaian, sehingga total biaya tidak dijamin nol. Jangan simpan connection string, token, email pengguna, nama resource produksi, atau hasil ekspor data produksi di Git.

## Domain

URL produksi drive: `https://drive.alfi.ai.id/`. Frontend memakai base `/`; login/logout dan public link memakai hostname yang sama.

Record Cloudflare CNAME `drive` mengarah langsung ke hostname Azure Static Web Apps dengan proxy dinonaktifkan (DNS only). Daftarkan subdomain melalui `az staticwebapp hostname set --validation-method cname-delegation`; Azure memvalidasi DNS dan menyediakan sertifikat HTTPS.

Cloudflare Worker [`scripts/drive-proxy.mjs`](scripts/drive-proxy.mjs) mengalihkan URL lama `/drive`, `/drive/*`, `/api/*`, dan `/.auth/*` pada domain utama ke subdomain baru dengan status 308, mempertahankan path dan query public link. Halaman utama tetap memakai origin website sebelumnya. Worker tidak lagi membutuhkan binding `AZURE_ORIGIN` atau route validasi sertifikat.

Verifikasi redirect lokal: `node scripts/test-drive-proxy.mjs`. Sesudah deploy, cek halaman, aset, API anonim, serta hostname callback dan domain cookie login. Login penuh tetap perlu dilakukan memakai akun pemilik.

## CI/CD

Workflow `.github/workflows/azure-static-web-apps.yml` memakai `Azure/static-web-apps-deploy@v1`. Setiap push ke `main` membangun `web` (hasil `dist`) dan API `api`, lalu men-deploy ke Static Web App produksi. Pull request ke `main` dibangun dan di-deploy ke environment pratinjau, yang ditutup saat pull request ditutup. Workflow juga bisa dijalankan manual lewat `workflow_dispatch`.

Satu secret GitHub wajib ada di repo: `AZURE_STATIC_WEB_APPS_API_TOKEN`, berisi deployment token Static Web App. Ambil token dengan `az staticwebapp secrets list --name <your-swa-name> --resource-group <your-resource-group> --query "properties.apiKey" -o tsv`, lalu simpan lewat `gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN`. Connection string tetap disimpan sebagai application settings Static Web App, bukan di repo atau workflow.

## Batasan

- Tidak ada pratinjau atau thumbnail otomatis dan pemindaian malware.
- Data tidak dimigrasikan otomatis. Untuk memakai database Cosmos yang sudah ada, atur `COSMOS_DATABASE` ke nama database tersebut dan pertahankan `OWNER_EMAIL` sesuai partisi berkas yang sudah ada. Akun dalam `OWNER_EMAILS` semuanya mengakses partisi dan kuota tersebut.
- Paket Static Web Apps Free tidak memiliki SLA. Biaya Cosmos DB dan Blob Storage bergantung pada pemakaian.
