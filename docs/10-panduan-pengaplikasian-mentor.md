# PANDUAN PENGAPLIKASIAN & PRESENTASI UNTUK MENTOR
**Proyek: Asisten Data Depok (Chatbot Grounded & Inventaris Data Publik Kota Depok)**  
**Versi Prototipe:** 0.4.0  
**Repositori Resmi:** [https://github.com/Andikaputh/asisten-data-depok](https://github.com/Andikaputh/asisten-data-depok)  
**Penyusun:** Tim Pengembang Kolaborasi Proyek  

---

## 1. Ringkasan Eksekutif

**Asisten Data Depok** adalah prototipe asisten kecerdasan buatan dan navigasi cerdas yang dirancang khusus untuk mempermudah masyarakat, akademisi, dan perangkat daerah dalam menemukan serta memahami data publik Kota Depok (Portal *Satu Data Depok*).

### Masalah yang Diselesaikan:
1. **Halusinasi Model AI Konvensional:** Model LLM umum (seperti ChatGPT mentah) sering mengarang angka statistik, menggabungkan data antar-kota secara keliru, atau menyebutkan sumber fiktif.
2. **Keterpisahan Informasi di Portal Publik:** Warga sering kesulitan menavigasi ribuan dataset, dokumen publikasi PDF, dan lembar kerja statistik XLSX.
3. **Ketergantungan Kuota Cloud & Privasi:** Sistem ini didesain agar dapat berjalan **100% secara lokal** menggunakan engine Ollama tanpa membocorkan data pencarian dan tanpa biaya langganan API berbayar.

---

## 2. Arsitektur Teknis & Mekanisme Kerja

Sistem dibangun dengan pendekatan **Grounding Ketat & Verifikasi Mekanis Berlapis** (*Grounded RAG with Fact-First Verification*):

```
                       ┌──────────────────────────────────────────────┐
                       │               PENGGUNA / WARGA              │
                       └──────────────────────┬───────────────────────┘
                                              │
                       ┌──────────────────────▼───────────────────────┐
                       │          ANTARMUKA WEB BERSIH (VANILLA)      │
                       │  - Simulasi Portal Satu Data Kota Depok      │
                       │  - Widget Cepat "Tanya Data"                │
                       │  - Ruang Chat Penuh + Panel Kartu Rujukan    │
                       │  - Workspace Kurator & Cakupan Portal        │
                       └──────────────────────┬───────────────────────┘
                                              │
                      ┌───────────────────────▼───────────────────────┐
                      │             PENGAMAN RUANG LINGKUP           │
                      │  - Deteksi topik umum (resep/coding/puisi)    │
                      │  - Pencegahan Prompt Injection & manipulasi  │
                      └───────┬───────────────────────────────┬───────┘
                              │                               │
             [Pertanyaan Angka / Rumus]            [Pencarian Katalog / Narasi]
                              │                               │
       ┌──────────────────────▼───────┐       ┌───────────────▼───────────────┐
       │   KORPUS TABEL TERVERIFIKASI │       │   INVENTARIS PORTAL & TEKS    │
       │  - SQLite (data angka pasti) │       │  - 2.242 URL Dataset Publik   │
       │  - Penarikan baris CSV pasti │       │  - Teks Halaman HTML Publik   │
       │  - TANPA GENERASI HALUSINASI │       │  - Teks Lampiran PDF & XLSX   │
       └──────────────┬───────────────┘       └───────────────┬───────────────┘
                      │                                       │
                      │                       ┌───────────────▼───────────────┐
                      │                       │  PENCARIAN HYBRID (BM25+VEC)  │
                      │                       │  Peringkat Bukti Dokumen Asli │
                      │                       └───────────────┬───────────────┘
                      │                                       │
                      │                       ┌───────────────▼───────────────┐
                      │                       │     LLM LOKAL / KONTRAK       │
                      │                       │  Hanya menyusun dari bukti   │
                      │                       │  (Ollama Qwen2.5 / BGE-M3)    │
                      │                       └───────────────┬───────────────┘
                      │                                       │
                      └───────────────────────┬───────────────┘
                                              │
                       ┌──────────────────────▼───────────────────────┐
                       │   PEMERIKSAAN KLAIM & SITASI MEKANIS         │
                       │  - Validasi bahwa setiap angka ada di bukti  │
                       │  - Pengembalian ke kutipan jika klaim cacat  │
                       └──────────────────────┬───────────────────────┘
                                              │
                                   [ Jawaban Bersumber ]
```

### Empat Tingkatan Bukti Transparan:
1. **Terverifikasi (`verified`):** Dokumen atau tabel CSV lokal yang sudah ditinjau oleh operator data manusia. Angka statistik pasti diambil hanya dari level ini.
2. **Lampiran terbaca · belum ditinjau (`attachment-read`):** Teks dari berkas PDF atau XLSX publik portal yang diekstrak secara otomatis oleh sistem (menggunakan `unpdf` dan `read-excel-file`). Belum diabsahkan oleh peninjau manual.
3. **HTML terbaca · belum ditinjau (`portal-read`):** Halaman detail dataset, panduan, atau metadata HTML yang diambil langsung dari portal resmi.
4. **Terdaftar di portal (`catalogued`):** Judul, penerbit, topik, dan tautan asli yang terindeks di katalog portal, namun isi berkasnya belum dibaca.

---

## 3. Prasyarat Sistem & Dependensi

Untuk menjalankan prototipe ini, lingkungan sistem membutuhkan:
- **Node.js:** Versi **>= 24.0.0** (menggunakan native SQLite engine, modern fetch, dan test runner `node:test`).
- **NPM:** Bawaan Node.js.
- **Git:** Untuk sinkronisasi kode.
- **RAM Laptop / Server:** Minimal 8 GB RAM (disarankan 16 GB jika menjalankan model LLM lokal).
- **Ollama (Opsional, untuk mode offline):**
  - Model inferensi instruksi: `ollama run qwen2.5:3b-instruct`
  - Model embedding teks: `ollama pull bge-m3`
  - *Catatan: Jika tanpa Ollama, sistem tetap dapat beroperasi penuh dalam mode pencarian semantik BM25 dan pembacaan kutipan ekstraktif.*

---

## 4. Panduan Langkah demi Langkah Pengaplikasian

### Langkah 1: Kloning Repositori
```bash
git clone https://github.com/Andikaputh/asisten-data-depok.git
cd asisten-data-depok
```

### Langkah 2: Pemasangan Dependensi
```bash
npm install
```

### Langkah 3: Konfigurasi Berkas Lingkungan (`.env`)
Salin templat konfigurasi yang disediakan:
```bash
# Untuk Windows PowerShell:
Copy-Item .env.example .env

# Untuk Linux / macOS:
cp .env.example .env
```
Isi berkas `.env` default sudah dioptimalkan untuk pengoperasian lokal:
```ini
PORT=3000
RAG_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_CHAT_MODEL=qwen2.5:3b-instruct
OLLAMA_EMBEDDING_MODEL=bge-m3
```

### Langkah 4: Memuat Sumber Data Awal & Indeks
Jalankan skrip berikut untuk menyelaraskan sumber data terkurasi dan mengaktifkan korpus:
```bash
# 1. Menyelaraskan sumber data publik lokal
npm run sources:sync

# 2. Menyetujui sumber yang sudah diperiksa (status: verified)
npm run sources:approve-reviewed

# 3. Menghangatkan model & memvalidasi korpus RAG
npm run rag:activate
```

### Langkah 5: Menjalankan Server Aplikasi
```bash
npm start
```
Buka peramban (browser) di alamat:
- **Portal Simulasi Publik:** [http://127.0.0.1:3000/](http://127.0.0.1:3000/)
- **Halaman Chatbot Penuh:** [http://127.0.0.1:3000/chat](http://127.0.0.1:3000/chat)
- **Workspace Kurator & Administrator:** [http://127.0.0.1:3000/workspace](http://127.0.0.1:3000/workspace)

---

## 5. Fitur Unggulan Versi 0.4.0 (Terbaru)

1. **Ekstraksi Mandiri Lampiran PDF & XLSX Portal:**
   - Mengambil isi publikasi statistik (PDF) dan tabel data (XLSX).
   - Dilengkapi *safety guardrails*: deteksi *magic bytes* (mencegah file HTML tipuan), proteksi *zip-bomb* (maksimal dekompresi 100 MB), dan pembatasan panjang teks (maksimal 2.000.000 karakter).
   - Berkas yang terpotong ditandai `partial` dan tidak dimasukkan ke indeks pencarian utama demi menjaga kualitas jawaban.
2. **Sinkronisasi Katalog Bertahap & Kepatuhan Etika Scraping:**
   - Mematuhi `robots.txt` portal.
   - Jeda minimal 500 ms per permintaan agar tidak membebani server pemerintah.
   - Batch terbatas (default 40 halaman dan 5 lampiran) yang dapat dihentikan kapan saja secara aman.
3. **Pencadangan & Pemulihan Terintegrasi (JSON Backup v3):**
   - Seluruh dokumen, observasi terverifikasi, halaman terindeks, dan status ekstraksi dapat diekspor menjadi satu berkas JSON terenkapsulasi hash SHA-256 (`npm run backup` dan `npm run restore`).
   - Mencegah manipulasi data: jika satu baris diubah, pemulihan dibatalkan otomatis (*atomic*).

---

## 6. Skenario Demo untuk Mentor (Estimasi: 5 Menit)

Saat mempresentasikan ke mentor, ikuti skenario terstruktur berikut:

| No | Tindakan / Pertanyaan | Hasil yang Ditunjukkan ke Mentor | Penjelasan Konsep untuk Mentor |
|:--:|:---|:---|:---|
| **1** | Buka [http://127.0.0.1:3000/](http://127.0.0.1:3000/) | Tunjukkan antarmuka mirip Satu Data Depok dan klik widget **"Tanya Data"** di kanan bawah. | "Kami membuat akses percakapan langsung di halaman portal agar warga tidak bingung mencari menu." |
| **2** | Masuk ke chat penuh, ajukan:<br>***"Berapa persentase penanganan sampah di Kota Depok tahun 2025?"*** | Chatbot menjawab tepat: **"53,09 persen"** dan menampilkan tombol rujukan sumber CSV. | "Angka ini diambil langsung dari observasi CSV baris 6 yang terverifikasi, **bukan hasil karangan/halusinasi LLM**." |
| **3** | Pertanyaan lanjutan kontekstual:<br>***"Kalau 2024?"*** | Chatbot mempertahankan indikator sampah dan menjawab: **"39 persen"**. | "Sistem memiliki *context-aware state tracking* sehingga memahami kelanjutan percakapan tanpa mengulang indikator." |
| **4** | Ajukan pertanyaan konseptual:<br>***"Apa itu metadata?"*** | Jawaban berupa definisi naratif lengkap dengan rujukan definisi standar data resmi. | "Untuk pertanyaan deskriptif, LLM lokal menyusun kalimat hanya dari bukti teks yang ditemukan (*grounded generation*)." |
| **5** | Ajukan pencarian katalog luas:<br>***"Ada data anak disabilitas?"*** atau ***"Cari publikasi kesehatan"*** | Menampilkan daftar judul dataset, penerbit dinas terkait, dan tautan resmi. | "Sistem mengindeks 2.200+ URL dataset Satu Data Depok; pencarian katalog cepat tanpa membebani LLM." |
| **6** | Ajukan pertanyaan di luar domain:<br>***"Buatkan resep nasi goreng"*** | Sistem menolak dengan sopan dan menegaskan bahwa ia hanya bertugas untuk data publik Depok. | "Sistem memiliki pelindung ruang lingkup (*guardrail*), tidak dapat dimanfaatkan untuk hal di luar data Depok." |
| **7** | Buka **Workspace → Cakupan Portal** | Menunjukkan statistik URL dataset terindeks, antrean halaman, dan lampiran PDF/XLSX terbaca. | "Ada pemisahan tegas antara data terdaftar di katalog, teks yang dibaca otomatis, dan data yang sudah ditinjau manusia." |

---

## 7. Bukti Validasi & Jaminan Kualitas

Prototipe ini dilengkapi uji otomatis menyeluruh yang dapat diverifikasi oleh mentor:

1. **Pengujian Unit & Integrasi HTTP (`npm test`):**
   - **70 dari 70 tes lulus (100% pass)** mencakup: parser CSV, pembacaan observasi, penolakan halusinasi, adapter Ollama, mitigasi zip-bomb, penanganan robots.txt, ekstraksi PDF/XLSX, dan integritas cadangan.
2. **Pengujian Browser End-to-End (`npm run test:e2e`):**
   - Menjalankan Playwright otomatis pada skenario desktop dan mobile (lebar layar 390px).
   - Memastikan tidak ada layout overflow, tidak ada *console error*, dan riwayat percakapan tersimpan rapi.
3. **Pemeriksaan Tipe & Skrip (`npm run check`):**
   - Lulus pengecekan TypeScript tanpa kompilasi build yang rumit (*zero build step*).

---

## 8. Batasan Sistem & Rencana Tindak Lanjut

Untuk menjaga transparansi akademik dan profesional kepada mentor, sampaikan batasan saat ini:
1. **Bukan Layanan Resmi Pemerintah:** Proyek ini adalah purwarupa studi independen/kolaboratif, belum diintegrasikan ke basis data internal tertutup Pemkot Depok.
2. **Tidak Ada OCR Gambar/Scan:** PDF hasil scan gambar tanpa lapisan teks tidak dibaca secara paksa demi menghindari kesalahan pembacaan angka.
3. **Belum Mendukung Agregasi Statistik Lintas Tabel:** Asisten membaca angka langsung dari baris yang tersedia di publikasi; kalkulasi rumus kompleks multi-dataset belum diotomatisasi untuk mencegah galat kalkulasi.
4. **Pemisahan Hak Akses:** Workspace admin saat ini dirancang untuk operasional lokal, belum memiliki modul otentikasi multi-user berbasis RBAC (Role-Based Access Control) publik.

---
*Dokumen ini disusun untuk memfasilitasi sesi evaluasi dan bimbingan bersama mentor teknis proyek.*
