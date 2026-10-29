# Asisten Data Depok — prototipe RAG 0.2

Simulasi portal Satu Data Kota Depok dengan popup dan halaman percakapan penuh, pencarian sumber publik, pembacaan CSV, dan integrasi LLM lokal Ollama (opsional OpenAI API). Tidak perlu melatih model dari nol. Ini proyek magang mandiri, bukan layanan resmi pemerintah.

## Status nyata

- Portal, popup, percakapan penuh, riwayat, dan detail sumber sudah berfungsi.
- Korpus pilot di workspace ini berisi **4 sumber publik yang telah diperiksa**: pengertian metadata, metadata penanganan sampah, metadata kinerja perangkat daerah, dan CSV penanganan sampah. CSV memuat **5 observasi tahunan (2021–2025)**.
- Dua metadata tambahan masih berstatus belum diperiksa untuk penggunaan jawaban, karena isi/konteksnya memerlukan peninjauan lanjutan. Tiga kandidat katalog dan tiga panduan latihan tetap dipisahkan.
- Pencarian kata kunci dan pembacaan angka dapat digunakan tanpa LLM.
- Integrasi Ollama (LLM lokal) dan OpenAI Responses API sudah diimplementasikan. Jalur Ollama gratis dan berjalan tanpa kunci API; uji 29 Oktober 2026 lulus 4/4 dengan `qwen2.5:3b-instruct` + `bge-m3`, indeks embedding 5/5, dan mode `generated` + `hybrid`. Jalur OpenAI memerlukan API key valid serta akses/kuota model.
- Aplikasi tidak menyamarkan fallback sebagai jawaban model. Jika API atau validasi bukti gagal, pengguna menerima kutipan sumber dengan pemberitahuan.

## Jalankan

Memerlukan Node.js 24 atau lebih baru. Di PowerShell, pada folder proyek:

```powershell
npm.cmd ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm.cmd start
```

Di macOS/Linux gunakan `npm`, bukan `npm.cmd`.

| Alamat | Fungsi |
| --- | --- |
| [Portal](http://127.0.0.1:3000/) | Simulasi portal dan popup chatbot |
| [Percakapan](http://127.0.0.1:3000/chat) | Chatbot untuk pengunjung |
| [Workspace](http://127.0.0.1:3000/workspace?view=pipeline) | Koleksi, verifikasi, indeks, status LLM, dan uji API |

Server hanya menerima akses loopback. Jika port sudah dipakai, ubah PORT pada `.env`. Mode pengembangan: `npm.cmd run dev`.

## Aktifkan model lokal Ollama (gratis)

Jalur ini tidak memakai kredit API. Inferensi berjalan di laptop dan hasilnya tetap diperiksa terhadap sumber.

1. Pasang Ollama dari [ollama.com/download](https://ollama.com/download), atau di PowerShell:

```powershell
winget install --id Ollama.Ollama --exact
```

2. Unduh model sekali saja (total sekitar 3,5 GB):

```powershell
ollama pull qwen2.5:3b-instruct
ollama pull bge-m3
```

3. Salin `.env.example` ke `.env` saat clone pertama (jangan menimpa `.env` yang sudah ada). Pastikan konfigurasinya:

```dotenv
PORT=3000
RAG_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_CHAT_MODEL=qwen2.5:3b-instruct
OLLAMA_EMBED_MODEL=bge-m3
```

4. Pada clone baru, isi koleksi pilot dari sumber publik dan cocokkan snapshot yang sudah ditinjau:

```powershell
npm.cmd run sources:sync -- --include-csv
npm.cmd run sources:approve-reviewed
```

Langkah ini memerlukan internet. Jika konten sumber berubah, hash yang berbeda tidak diloloskan otomatis: tinjau ulang, jangan memaksa status terverifikasi. Di laptop demo yang koleksinya sudah siap, tidak perlu mengambil ulang sumber menjelang presentasi.

5. Jalankan uji nyata (sekaligus pemanasan model sebelum demo):

```powershell
npm.cmd run rag:activate
```

Perintah tersebut membangun indeks embedding lalu memeriksa empat kasus: pengertian metadata, rumus sampah, angka 2025, serta pertanyaan tanpa data. Dua kasus pertama harus memakai model (`mode: generated`), bukan fallback; skrip menolak lulus bila model hanya memilih kutipan. Laporan disimpan pada `.artifacts/rag-live-latest.json`; jangan anggap lulus kecuali `ok: true`. Hasil workspace 29 Oktober 2026: `ok: true`, 4/4 kasus, `method: hybrid`, indeks 5/5.

Ollama biasanya sudah berjalan otomatis setelah instalasi (ikon di tray). Jika belum, jalankan `ollama serve`. Laptop 16 GB dengan GPU terintegrasi memakai model 3B agar responsif; mesin yang lebih kuat dapat mencoba `qwen2.5:7b-instruct` atau `gemma3:4b` dengan mengubah `OLLAMA_CHAT_MODEL`. Model embedding `bge-m3` dipilih karena mendukung bahasa Indonesia.

Alternatif melalui UI: buka **Workspace → Alur & model → Uji RAG dengan model**. Tombol ini membangun indeks publik yang diperlukan dan menjalankan satu pertanyaan melalui LLM.

Jalur Ollama kini menyusun klaim bersumber (`mode: generated`) memakai aturan dan pemeriksaan yang sama dengan jalur OpenAI. Jika keluaran model lokal tidak lolos skema atau validasi kutipan, sistem otomatis turun ke pemilihan kutipan (`mode: model-assisted`) atau kutipan lokal, disertai pemberitahuan. Status “model siap” berarti model terpasang di Ollama, bukan jaminan kualitas jawaban; uji dengan pertanyaan contoh tetap diperlukan.

## Opsional: OpenAI API

Jika ingin memakai OpenAI, ubah `.env` menjadi `RAG_PROVIDER=openai` dan isi `OPENAI_API_KEY` milik akun yang memiliki akses/kuota API. Jangan kirim API key ke chat, simpan di source frontend, atau commit ke Git. `.env` diabaikan oleh Git.

```dotenv
RAG_PROVIDER=openai
OPENAI_API_KEY=
OPENAI_CHAT_MODEL=gpt-5.4-mini
OPENAI_EMBED_MODEL=text-embedding-3-small
```

Konfigurasi dibaca ulang pada permintaan berikutnya; server tidak perlu dimulai ulang untuk perubahan kunci/model. Jalankan `npm.cmd run rag:activate` untuk uji nyata.

Panggilan OpenAI memakai layanan berbayar sesuai akun/model dan token yang digunakan. Status “kunci terisi” hanya memastikan konfigurasi tersedia, bukan membuktikan saldo, izin, atau respons model. Kegagalan autentikasi, kuota, akses model, dan koneksi ditangani tanpa mengekspos kunci.

## Contoh pertanyaan

Pilih **Koleksi publik** pada bagian atas percakapan. Pilihan ini menjadi default ketika sumber publik tersedia pada versi baru.

- “Apa itu metadata?”
- “Apa rumus persentase penanganan sampah?”
- “Apa satuan persentase penanganan sampah?”
- “Berapa persentase penanganan sampah di Kota Depok tahun 2025?”
- Lanjutkan dengan “Kalau 2024?”
- “Cari dataset penduduk Kelurahan Depok” untuk pencarian kandidat katalog.

Kasus angka sampah 2025 menghasilkan **53,09 persen**, dari baris keenam CSV publik (termasuk header). Itu merupakan observasi pada sumber, bukan perhitungan atau estimasi model. Data 2026 dan wilayah yang tidak tercakup tidak diisi dengan tebakan.

Mode simulasi/latihan tetap tersedia untuk panduan buatan aplikasi dan dipisahkan dari koleksi publik.

## Cara RAG bekerja

```text
Sumber publik yang dipilih
  → simpan salinan mentah dan hash
  → ekstrak metadata / normalisasi CSV
  → tinjau isi dan konteks
  → status sumber terverifikasi lokal
  → potongan teks + SQLite FTS5 + embedding API

Pertanyaan
  → kenali kebutuhan dan rincian konteks
  → teks: BM25 + pencarian semantik + penggabungan peringkat
  → LLM lokal (Ollama) atau OpenAI dengan bukti yang ditemukan
  → OpenAI: output terstruktur klaim + ID bukti + kutipan asli
  → Ollama: pilih ID kutipan, lalu susun kalimat hanya dari kutipan itu
  → pemeriksaan ID, kutipan, angka, status sumber
  → jawaban dengan rujukan

Pertanyaan angka
  → cocokkan indikator, tahun, wilayah, dan satuan
  → baca nilai dari observasi CSV terverifikasi
  → tampilkan nilai asli dengan lokasi baris sumber
```

Model tidak membuat URL; backend mengambil URL dari katalog. Kutipan harus ditemukan dalam potongan sumber yang diberikan. Angka pada klaim teks harus muncul pada kutipan pendukung. Sumber yang ditarik saat permintaan berlangsung tidak boleh mendukung hasil baru. Jika pemeriksaan gagal, respons model tidak ditampilkan sebagai jawaban sah.

Pemeriksaan mekanis tersebut belum merupakan pembuktian penuh terhadap makna semua klaim. Evaluasi manusia tetap diperlukan, terutama untuk definisi, perbandingan, dan konteks indikator. RAG tidak menjamin semua pertanyaan terjawab benar.

## Mengelola sumber

### Sumber pilot terkurasi

```powershell
npm.cmd run sources:sync -- --include-csv
npm.cmd run sources:approve-reviewed
```

Pengambilan hanya memakai halaman publik yang ditentukan dalam `data/public-sources.json` dan satu resource CSV yang ditautkan pada tombol pratinjau portal. Tidak menelusuri seluruh situs, login, atau melewati penolakan akses.

Sumber baru selalu masuk sebagai **belum diperiksa**. Perintah approve hanya mengaktifkan salinan dengan URL dan hash konten yang sama persis dengan `data/reviewed-public-sources.json`, yaitu snapshot yang sudah diperiksa pada 26 Oktober 2026. Jika isi berubah, lakukan pemeriksaan baru; jangan mengganti hash hanya untuk meloloskan proses.

“Diperiksa” berarti kesesuaian ekstraksi dengan salinan publik dan konteks yang dicatat, bukan pengesahan atau audit statistik oleh Pemkot Depok. Metadata kinerja perangkat daerah memiliki catatan tidak lagi menjadi indikator kegiatan sejak 2025; keterangan itu dipertahankan.

### Impor manual

Buka **Workspace → Koleksi sumber → Tambah sumber**, lalu isi judul, penerbit, URL HTTPS, teks/file, dan konteks yang diketahui. TXT, Markdown, serta CSV standar didukung. Cocokkan salinan dengan sumber asli sebelum verifikasi. Jika mengganti sumber, nonaktifkan salinan lama setelah versi baru ditinjau; versi berbeda tidak otomatis ditimpa.

CSV manual memakai pemisah koma dan header:

```csv
indicator,year,region,value,unit
```

Nilai manual memakai titik desimal tanpa pemisah ribuan. Nilai kosong dan “-” tidak dianggap nol. Parser CSV pilot secara terpisah menangani titik koma dan koma desimal sesuai file publik yang diperiksa. Urutan/baris sumber dipertahankan.

Setelah menambah sumber, klik **Bangun indeks embedding**. Hanya potongan yang belum memiliki embedding dari provider/model aktif yang diproses. Tanpa indeks semantik, pencarian kata kunci tetap berjalan dengan pemberitahuan yang sesuai.

## Pengujian

```powershell
npm.cmd run check
npm.cmd test
npx.cmd playwright install chromium
npm.cmd run test:e2e
npm.cmd run test:corpus
npm.cmd run rag:activate
# Server lokal harus sudah berjalan untuk tes berikut:
npm.cmd run test:e2e:live
```

- `check`: pemeriksaan sintaks/modul JavaScript.
- `test`: unit, HTTP, parser, persistensi, serta SDK OpenAI/Ollama dengan server tiruan. Tidak memakai API key asli.
- `test:e2e`: portal → popup → full chat, riwayat, drawer mobile, impor/review/angka, dan pemisahan koleksi. Database uji terpisah.
- `test:e2e:live`: browser terisolasi terhadap server lokal + Ollama sungguhan: definisi, rumus, satuan, angka 2025, tindak lanjut 2024, data yang tidak tersedia, kartu sumber, reload, dan mobile. Fallback tidak dihitung sebagai generasi berhasil. Hasil: `.artifacts/live-browser-latest.json`.
- `test:corpus`: 18 kasus regresi menggunakan korpus publik pada workspace, tanpa LLM. Tidak sama dengan benchmark umum akurasi RAG.
- `rag:activate`: pengujian provider sungguhan; membutuhkan Ollama yang berjalan, atau kunci dan kuota OpenAI.

Uji browser memakai Chromium bawaan Playwright dengan profil sementara, tanpa akun/profil browser pribadi. Pasang sekali dengan `npx playwright install chromium`. Alternatifnya tentukan `BROWSER_PATH` secara eksplisit. Screenshot dan laporan rinci berada dalam `.artifacts/`.

GitHub Actions menjalankan pemeriksaan kode, unit test, dan e2e dengan database sementara. Tes Ollama live dan regresi korpus lokal tidak dijalankan di CI karena memerlukan model serta koleksi yang sudah ditinjau. Checklist demo: [docs/08-checklist-presentasi.md](docs/08-checklist-presentasi.md).

`.env`, database SQLite, salinan mentah, hasil uji, sesi browser, dan keluaran graphify lokal tidak ikut Git. Repository tidak menyertakan model Ollama atau koleksi database laptop; ikuti langkah penyiapan di atas setelah clone.

## Alternatif Ollama

Jalur utama workspace ini adalah Ollama; lihat [Aktifkan model lokal Ollama](#aktifkan-model-lokal-ollama-gratis). Aplikasi tidak mengunduh atau melatih model otomatis. Untuk beralih ke OpenAI, lihat [Opsional: OpenAI API](#opsional-openai-api).

## Lokasi file

| Lokasi | Fungsi |
| --- | --- |
| `public/index.html`, `portal.js`, `portal.css` | Portal dan popup |
| `public/chat.html`, `full-chat.js`, `full-chat.css` | Percakapan pengunjung |
| `public/workspace.html`, `app.js`, `styles.css` | Pengelolaan lokal |
| `server/chat.js`, `retrieval.js` | Routing pertanyaan, pencarian, konteks dan nilai tabel |
| `server/model.js`, `grounding.js`, `indexing.js` | API LLM/embedding, validasi klaim dan indeks |
| `server/public-sources.js` | Pengambilan dan parser sumber publik terkurasi |
| `server/store.js` | SQLite, versi/hash, observasi dan catatan panggilan |
| `data/corpus.sqlite` | Koleksi lokal; diabaikan Git |
| `data/raw/` | Salinan mentah untuk pemeriksaan; diabaikan Git |
| `data/reviewed-public-sources.json` | URL/hash snapshot yang diperiksa dan batasannya |
| `docs/` | Proposal, desain, dan laporan verifikasi |

Kunci tidak dikirim ke browser. Jalur Ollama tidak memerlukan kunci sama sekali. Diagnostik hanya memuat status konfigurasi, model, jumlah indeks, dan hasil panggilan. Log aplikasi menyimpan waktu, status, kode galat, serta penggunaan token respons LLM; tidak menyimpan API key atau pertanyaan mentah. Permintaan OpenAI menggunakan store:false; ini tidak menjadi klaim bahwa seluruh kebijakan retensi penyedia ditiadakan.

## Batas dan serah terima

Koleksi pilot masih kecil dan belum mencakup seluruh portal. Tidak ada PDF/XLSX, crawler menyeluruh, perhitungan lintas baris, atau sinkronisasi berkala. Tahun observasi tidak disimpulkan dari tanggal pembaruan. Riwayat lama merupakan snapshot; periksa sumber terkini jika kemudian dinonaktifkan.

Workspace belum memakai autentikasi multi-pengguna dan hanya ditujukan untuk lingkungan lokal. Jangan membuka server ini ke publik tanpa menambahkan autentikasi pengelolaan, pembatasan pemakaian, dan peninjauan operasional. Batas prototipe: 100 dokumen aktif, 500 ribu karakter/dokumen, CSV maksimal 5000 baris.

Untuk backup penuh, hentikan server lalu salin folder data. Ekspor JSON tersedia sebagai arsip, tetapi pemulihan lewat UI belum disediakan. Percakapan disimpan di browser; sumber disimpan di SQLite.

Identitas visual merujuk [Satu Data Depok](https://satudata.depok.go.id/): navy #243062, marun #873230, dan biru muda #F3F6FF. [Logo](https://satudata.depok.go.id/assets-publik/img/logo-sadepok.png) dan [ilustrasi](https://satudata.depok.go.id/assets-publik/img/illustrations/hero-illustration.svg) berasal dari aset publik portal untuk simulasi ini. Ringkasan 2.240 dataset, 25 visualisasi, 97 infografis, dan 105 organisasi pada halaman portal adalah cuplikan 26 Oktober 2026, bukan jumlah sumber chatbot.

Rujukan implementasi: [OpenAI Responses/structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [embeddings](https://developers.openai.com/api/docs/guides/embeddings), dan dokumentasi AI SDK yang sesuai versi terpasang dalam node_modules.
