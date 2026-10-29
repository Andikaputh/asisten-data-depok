# Asisten portal 0.3 — cakupan, alur, dan batas

## Tujuan

Membantu masyarakat menavigasi sumber publik Portal Satu Data Depok dengan bahasa sehari-hari: menemukan dataset, publikasi, infografis, dashboard, organisasi, kategori, dan petunjuk. Bukan chatbot umum dan bukan klaim seluruh konten telah dipahami sempurna.

## Empat perilaku utama

1. **Ada entri katalog:** tampilkan judul, penerbit jika tercantum, jenis sumber, dan tautan asli. Tidak membutuhkan LLM untuk membuat daftar.
2. **Ada isi yang berhasil dibaca:** tampilkan kutipan halaman atau kalimat model yang lolos pemeriksaan mekanis. Pembacaan otomatis tidak sama dengan review manusia.
3. **Belum cukup bukti:** katakan belum ditemukan/belum terbaca dalam indeks. Jangan menyatakan sumber tidak ada di seluruh situs atau mengisi angka dari judul.
4. **Di luar ruang lingkup:** tolak tugas umum seperti resep, pembuatan kode atau puisi, lalu arahkan kembali ke pencarian portal. Permintaan mencari sebuah topik dalam katalog berbeda dari permintaan mengerjakan tugas umum tentang topik tersebut.

Pengamanan data pribadi dan manipulasi instruksi tetap berlaku. Menyisipkan kata “Depok” tidak otomatis menjadikan permintaan umum berada dalam ruang lingkup.

## Pemisahan penyimpanan

- `documents`, `chunks`, dan `observations`: korpus lama; status review dan data angka tidak ditimpa oleh scraper.
- `portal_items`: inventaris judul/tautan, format, penerbit, periode yang tertulis pada katalog, halaman penemuan, dan waktu terakhir terlihat.
- `portal_pages`: antrean URL, isi HTML yang berhasil diekstrak, hash, percobaan, waktu pengambilan, serta kegagalan.
- `portal_sync_runs`: jejak batch, pemilik proses, status berjalan/selesai/terhenti, dan jumlah kegagalan.
- SQLite FTS5 terpisah untuk katalog dan isi halaman. Tidak membangun embedding untuk ribuan judul hanya agar pencarian navigasi berfungsi.

URL unduh BPS dapat berubah token; identitas publikasi tidak disamakan dengan token unduh. Menu “Dataset” juga tidak dihitung sebagai sebuah URL detail dataset.

## Pengumpulan sumber

Seed meliputi beranda, profil, prinsip data, katalog, kategori, organisasi, publikasi, infografis, Data Insight, dan galeri. Pagination publik dinormalisasi; tautan Next yang tetap muncul setelah halaman kosong tidak diikuti tanpa akhir.

Batch berjeda minimal 500 ms (default sekitar satu detik), dibatasi jumlah halaman, dan dapat dilanjutkan. Saat penyegaran, halaman daftar/panduan yang sudah diambil masuk antrean kembali; data lama tidak dihapus hanya karena batch baru belum selesai. Tiga kegagalan berurutan atau HTTP 429 menghentikan batch. Tidak login, mengisi formulir, melewati captcha/WAF, atau mengikuti redirect yang belum diperiksa.

Jika halaman detail HTML relevan belum dibaca, server dapat mengambil satu halaman detail yang sudah ditemukan dalam inventaris saat diperlukan. URL tidak berasal dari model atau URL bebas yang diketik pengguna. Kegagalannya tersimpan dan tidak diulang terus pada setiap pertanyaan. Lampiran dan layanan eksternal tidak otomatis diambil lewat jalur ini.

`robots.txt` yang tidak dapat dibaca ditampilkan sebagai ketidakpastian, bukan dianggap izin. Untuk penggunaan produksi, perlu persetujuan/koordinasi pengelola dan, jika tersedia, API/ekspor inventaris resmi. Website dapat mempunyai halaman tak tertaut, AJAX, formulir, atau elemen interaktif yang belum dicakup parser.

## Jawaban dan provider

```text
Pertanyaan → pemeriksaan ruang lingkup
  ├ pencarian/navigasi → indeks katalog → daftar sumber asli
  ├ definisi/panduan → korpus ditinjau, lalu halaman portal yang terbaca
  ├ angka → tabel observasi ditinjau, bukan judul/metadata katalog
  └ tugas di luar portal → penolakan
```

Chat dan embedding dapat memakai provider berbeda: `ollama`, `openai`, atau API `openai-compatible`. Konfigurasi lama `RAG_PROVIDER` tetap menjadi default. API key hanya di backend. Pergantian model chat tidak mengganti identitas embedding. Tidak ada fallback berbayar diam-diam.

OAuth inference umum belum disediakan: memerlukan integrasi resmi masing-masing penyedia, bukan menyalin token sesi ChatGPT atau asisten coding. Login warga merupakan fitur yang berbeda dan juga belum menjadi autentikasi multi-pengguna pada prototipe lokal ini.

## Cakupan dan klaim yang dilarang

Halaman **Workspace → Cakupan portal** menampilkan entri, URL dataset dibanding label situs, panduan/detail yang terbaca, lampiran belum diekstrak, antrean, serta contoh kegagalan. Pengunjung juga melihat ringkasan indeks di chat.

`websiteComplete` tetap `false`. Jumlah URL dataset yang sama dengan angka beranda hanya menunjukkan pencocokan katalog pada snapshot tersebut, bukan bukti semua dokumen, tabel, gambar, dan konteks telah dipahami. Pengujian merupakan regresi terarah, bukan jaminan akurasi 100%.

Belum tersedia: ekstraksi PDF/XLSX umum, OCR infografis, pembacaan data Tableau/BPS eksternal, penjadwalan otomatis, penghitungan statistik bebas, ataupun autentikasi publik multi-pengguna. Fitur-fitur tersebut harus dikembangkan dan diuji terpisah sebelum mengklaim asisten lengkap seluruh portal.
