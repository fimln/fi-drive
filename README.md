# fi-drive

Drive pribadi untuk satu pemilik. Frontend React berjalan di Azure Static Web Apps; API terkelola menyimpan metadata di Azure Cosmos DB dan isi berkas di Azure Blob Storage privat.

## Fitur

- Login melalui Microsoft Entra ID bawaan Static Web Apps.
- Hanya akun Microsoft dengan email `OWNER_EMAIL` yang dapat memakai API privat. Akun lain ditolak (403).
- Kuota total drive 100 MiB (104.857.600 byte), tanpa pembagian kuota per pengguna. Semua tipe berkas diterima, termasuk Markdown, dengan batas 10 MiB per berkas.
- Upload, download, hapus berkas, dan public link dengan desain utama yang sama, tanpa Manage Members atau berbagi antaranggota.
- Public link dibatasi 50 unduhan per berkas, ditegakkan API dengan ETag. Link yang dibuat sebelum batas ini berlaku disesuaikan saat dipakai, dengan unduhan yang sudah terpakai tetap dihitung.

Blob tetap privat; unduhan publik melewati API tanpa login. Identitas privat diverifikasi melalui Static Web Apps. Tetapkan satu email pemilik sebelum menjalankan aplikasi; daftar email dipisahkan koma akan ditolak.

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

Buka `http://localhost:4280/.auth/login/aad` dan login sebagai `admin@example.com`, sesuai contoh `OWNER_EMAIL` di `api/local.settings.json`. Ganti `OWNER_EMAIL` dengan email Microsoft Anda untuk penggunaan pribadi. Berkas pengaturan lokal dan nilai rahasia produksi tidak boleh di-commit. Kunci di file contoh adalah kredensial emulator lokal yang dipublikasikan Azure, bukan kunci Azure produksi.

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
| `OWNER_EMAIL` | Satu email Microsoft pemilik drive |

Contoh dengan Azure CLI:

```powershell
az staticwebapp appsettings set --name <your-swa-name> --resource-group <your-resource-group> --setting-names COSMOS_CONNECTION="<cosmos-connection-string>" COSMOS_DATABASE=fidrive STORAGE_CONNECTION="<storage-connection-string>" FILES_CONTAINER=files OWNER_EMAIL=you@example.com
```

Cosmos memakai throughput bersama 400 RU/s untuk container `users`, `files`, dan `publicLinks`. Blob ditagih sesuai pemakaian, sehingga total biaya tidak dijamin nol. Jangan simpan connection string, token, email pengguna, nama resource produksi, atau hasil ekspor data produksi di Git.

## CI/CD

Workflow `.github/workflows/azure-static-web-apps.yml` memakai `Azure/static-web-apps-deploy@v1`. Setiap push ke `main` membangun `web` (hasil `dist`) dan API `api`, lalu men-deploy ke Static Web App produksi. Pull request ke `main` dibangun dan di-deploy ke environment pratinjau, yang ditutup saat pull request ditutup. Workflow juga bisa dijalankan manual lewat `workflow_dispatch`.

Satu secret GitHub wajib ada di repo: `AZURE_STATIC_WEB_APPS_API_TOKEN`, berisi deployment token Static Web App. Ambil token dengan `az staticwebapp secrets list --name <your-swa-name> --resource-group <your-resource-group> --query "properties.apiKey" -o tsv`, lalu simpan lewat `gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN`. Connection string tetap disimpan sebagai application settings Static Web App, bukan di repo atau workflow.

## Batasan

- Tidak ada pratinjau atau thumbnail otomatis dan pemindaian malware.
- Data tidak dimigrasikan otomatis. Untuk memakai database Cosmos yang sudah ada, atur `COSMOS_DATABASE` ke nama database tersebut dan `OWNER_EMAIL` ke email pemilik berkas di dalamnya; berkas milik email lain tidak akan terlihat.
- Paket Static Web Apps Free tidak memiliki SLA. Biaya Cosmos DB dan Blob Storage bergantung pada pemakaian.
